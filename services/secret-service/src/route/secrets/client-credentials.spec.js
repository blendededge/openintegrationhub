const supertest = require('supertest');
const nock = require('nock');
const iamMock = require('../../test/iamMock');
const SecretDAO = require('../../dao/secret');
const AuthClientDAO = require('../../dao/auth-client');
const token = require('../../test/tokens');

const conf = require('../../conf');
const Server = require('../../server');
const {
    OA2_CLIENT_CREDENTIALS,
} = require('../../constant').AUTH_TYPE;
const { ROLE } = require('../../constant');

let port;
let request;
let server;

describe('oauth2 client credentials', () => {
    beforeAll(async (done) => {
        port = 5117;
        request = supertest(`http://localhost:${port}${conf.apiBase}`);
        conf.crypto.isDisabled = false;
        
        // Configure IAM mock before server start
        iamMock.setup({
            mockUserToken: true,
            mockServiceAccount: true,
            baseUrl: `http://localhost:${port}`,
            skipAuth: true,
            token: {
                ...global.userAuth1[1], // Use the test token
                permissions: ['secrets.secret.readRaw']
            }
        });
        
        server = new Server({
            mongoDbConnection: global.__MONGO_URI__.replace('changeme', 'client-credentials'),
            port,
        });
        await server.start();
        done();
    });

    afterEach(async () => {
        await SecretDAO.deleteAll({});
        await AuthClientDAO.deleteAll({});
        nock.cleanAll();
    });

    afterAll(async (done) => {
        await server.stop();
        done();
    });

    describe('secret creation', () => {
        test('should create client credentials secret successfully', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            // Create auth client first
            const authClientPayload = {
                data: {
                    name: 'Example Client Credentials',
                    type: OA2_CLIENT_CREDENTIALS,
                    endpoints: {
                        token: 'https://example.com/token',
                    },
                    clientId: 'client123',
                    clientSecret: 'secret456',
                    owners: [
                        {
                            id: 'u2',
                            type: 'USER',
                        },
                    ],
                },
            };

            // Create auth client
            const authClientResponse = await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send(authClientPayload)
                .expect(200);

            const authClient = authClientResponse.body.data;
            expect(authClient._id).toBeDefined();

            // Mock token endpoint
            nock('https://example.com')
                .post('/token')
                .reply(200, {
                    access_token: accessToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with proper schema
            const secretPayload = {
                data: {
                    name: 'Client Credentials Secret',
                    type: OA2_CLIENT_CREDENTIALS,
                    value: {
                        authClientId: authClient._id,
                        scope,
                        // These will be populated by the handler
                        accessToken: undefined,
                        tokenType: undefined,
                        expires: undefined,
                        fullResponse: undefined,
                    },
                    owners: [], // Will be populated with current user
                },
            };

            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send(secretPayload)
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.type).toBe(OA2_CLIENT_CREDENTIALS);
            expect(secret.value.accessToken).toBe(accessToken);
            expect(secret.value.tokenType).toBe('Bearer');
            expect(secret.value.scope).toBe(scope);
            expect(secret.value.expires).toBeDefined();
            expect(secret.value.authClientId.toString()).toBe(authClient._id.toString());
        });

        test('should handle token request failure appropriately', async () => {
            const scope = 'foo bar';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials Error',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Verify auth client was created in database
            const storedAuthClient = await AuthClientDAO.findById(authClient._id);
            expect(storedAuthClient).toBeDefined();

            // Mock token endpoint with error
            example
                .post('/token')
                .reply(400, {
                    error: 'invalid_client',
                });

            // Attempt to create secret with client credentials
            const errorResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Error',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                    },
                })
                .expect(400);

            // Verify error response
            expect(errorResponse.body.message).toBeDefined();
            expect(errorResponse.body.message).toContain('Failed to get token');

            // Verify no secret was created in database
            const secret = await SecretDAO.findByAuthClient(authClient._id);
            expect(secret).toBeNull();
        });

        test('should handle missing auth client appropriately', async () => {
            const scope = 'foo bar';
            conf.crypto.isDisabled = true;

            const nonExistentId = '507f1f77bcf86cd799439011';

            // Verify auth client doesn't exist
            const authClient = await AuthClientDAO.findById(nonExistentId);
            expect(authClient).toBeNull();

            // Attempt to create secret with non-existent auth client
            await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Invalid',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: nonExistentId,
                            scope,
                        },
                    },
                })
                .expect(400);

            // Verify no secret was created
            const secret = await SecretDAO.findByAuthClient(nonExistentId);
            expect(secret).toBeNull();
        });

        test('should create encrypted client credentials secret', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = false;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials Encrypted',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint
            example
                .post('/token')
                .reply(200, {
                    access_token: accessToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with client credentials
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Encrypted',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.type).toBe(OA2_CLIENT_CREDENTIALS);
            expect(secret.value.accessToken).toBe(accessToken);

            // Verify secret was created in database with encryption
            const storedSecret = await SecretDAO.findOne({ _id: secret._id });
            expect(storedSecret).toBeDefined();
            expect(storedSecret.encryptedFields).toBeDefined();
            expect(storedSecret.encryptedFields.length).toBeGreaterThan(0);
        });
    });

    describe('token management', () => {
        test('should auto refresh expired token', async () => {
            const scope = 'foo bar';
            const oldToken = 'old_access_token';
            const newToken = 'new_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials Refresh',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock initial token endpoint
            example
                .post('/token')
                .reply(200, {
                    access_token: oldToken,
                    expires_in: 0, // Token is already expired
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with client credentials
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Refresh',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.value.accessToken).toBe(oldToken);

            // Mock token endpoint for refresh
            example
                .post('/token')
                .reply(200, {
                    access_token: newToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Get secret - should trigger auto refresh since token is expired
            const refreshedResponse = await request.get(`/secrets/${secret._id}`)
                .set(...global.userToken1ExtraPerm)
                .expect(200);

            expect(refreshedResponse.body.data.value.accessToken).toBe(newToken);

            // Verify refresh in database
            const storedSecret = await SecretDAO.findOne({ _id: secret._id });
            expect(storedSecret.value.accessToken).toBe(newToken);
            expect(storedSecret.value.expires).toBeDefined();
        });

        test('should handle token refresh failure appropriately', async () => {
            const scope = 'foo bar';
            const oldToken = 'old_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials Refresh Error',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock initial token endpoint
            example
                .post('/token')
                .reply(200, {
                    access_token: oldToken,
                    expires_in: 0, // Token is already expired
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with client credentials
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Refresh Error',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;

            // Mock token endpoint to fail on refresh
            example
                .post('/token')
                .reply(400, {
                    error: 'invalid_client',
                    error_description: 'Client credentials are invalid',
                });

            // Get secret - should attempt refresh but fail
            const errorResponse = await request.get(`/secrets/${secret._id}`)
                .set(...global.userToken1ExtraPerm)
                .expect(400);

            expect(errorResponse.body.message).toContain('Failed to get token');

            // Verify original token remains in database
            const storedSecret = await SecretDAO.findOne({ _id: secret._id });
            expect(storedSecret.value.accessToken).toBe(oldToken);
        });

        test('should handle credentials in header vs body correctly', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // Create auth client with header credentials
            const headerAuthClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials with Header Auth',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        includeCredentialsInHeader: true,
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint and verify auth header
            example
                .post('/token')
                .reply(200, function (uri, requestBody) {
                    // Verify credentials are in Authorization header
                    const authHeader = this.req.headers.authorization;
                    expect(authHeader).toBeDefined();
                    expect(authHeader).toBe(`Basic ${Buffer.from('client123:secret456').toString('base64')}`);
                    // Verify credentials are not in body
                    expect(requestBody).not.toContain('client_id');
                    expect(requestBody).not.toContain('client_secret');
                    return {
                        access_token: accessToken,
                        expires_in: 3600,
                        scope,
                        token_type: 'Bearer',
                    };
                });

            // Create secret with header auth
            await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Secret with Header Auth',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: headerAuthClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);

            // Create auth client with body credentials
            const bodyAuthClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials with Body Auth',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        includeCredentialsInHeader: false,
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint and verify body params
            example
                .post('/token')
                .reply(200, function (uri, requestBody) {
                    // Verify credentials are in body
                    expect(requestBody).toContain('client_id=client123');
                    expect(requestBody).toContain('client_secret=secret456');
                    // Verify no auth header
                    expect(this.req.headers.authorization).toBeUndefined();
                    return {
                        access_token: accessToken,
                        expires_in: 3600,
                        scope,
                        token_type: 'Bearer',
                    };
                });

            // Create secret with body auth
            await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Secret with Body Auth',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: bodyAuthClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);
        });

        test('should handle predefined scope correctly', async () => {
            const predefinedScope = 'predefined.scope';
            const requestedScope = 'requested.scope';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // Create auth client with predefined scope
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials with Predefined Scope',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        predefinedScope,
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint and verify scope
            example
                .post('/token')
                .reply(200, (uri, requestBody) => {
                    // Verify predefined scope is used instead of requested scope
                    expect(requestBody).toContain(`scope=${predefinedScope}`);
                    expect(requestBody).not.toContain(requestedScope);
                    return {
                        access_token: accessToken,
                        expires_in: 3600,
                        scope: predefinedScope,
                        token_type: 'Bearer',
                    };
                });

            // Create secret with a different scope (should be overridden)
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Secret with Predefined Scope',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope: requestedScope, // This should be ignored
                        },
                    },
                })
                .expect(200);

            // Verify the predefined scope was used
            const secret = secretResponse.body.data;
            expect(secret.value.scope).toBe(predefinedScope);

            // Verify in database
            const storedSecret = await SecretDAO.findOne({ _id: secret._id });
            expect(storedSecret.value.scope).toBe(predefinedScope);
        });
    });

    describe('access control', () => {
        test('should allow tenant-wide access to shared secret', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: token.userToken1.value.tenant,
                                type: 'TENANT',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint
            example
                .post('/token')
                .reply(200, {
                    access_token: accessToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with tenant-wide access
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Tenant Shared Secret',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                        owners: [
                            {
                                id: token.userToken1.value.tenant,
                                type: 'TENANT',
                            },
                        ],
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.owners.length).toBe(1);
            expect(secret.owners[0].type).toBe('TENANT');

            // Verify another user from same tenant can access
            const otherUserResponse = await request.get(`/secrets/${secret._id}`)
                .set(...global.userAuth1SecondUser)
                .expect(200);

            expect(otherUserResponse.body.data.name).toBe('Tenant Shared Secret');

            // Verify user from different tenant cannot access
            await request.get(`/secrets/${secret._id}`)
                .set(...global.userAuth2)
                .expect(403);
        });

        test('should manage owners of client credentials secret', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint
            example
                .post('/token')
                .reply(200, {
                    access_token: accessToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with client credentials
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.owners.length).toBe(1);

            // Add new owner
            const newOwner = {
                id: 'newUser',
                type: ROLE.USER,
            };

            const updatedSecret = await request.post(`/secrets/${secret._id}/owners`)
                .set(...global.userAuth1)
                .send({
                    data: newOwner,
                })
                .expect(200);

            expect(updatedSecret.body.data.owners.length).toBe(2);
            expect(updatedSecret.body.data.owners.find((o) => o.id === newOwner.id)).toBeDefined();

            // Remove owner
            await request.delete(`/secrets/${secret._id}/owners?id=${newOwner.id}&type=${newOwner.type}`)
                .set(...global.userAuth1)
                .expect(200);

            const finalSecret = await SecretDAO.findOne({ _id: secret._id });
            expect(finalSecret.owners.length).toBe(1);
            expect(finalSecret.owners.find((o) => o.id === newOwner.id)).toBeUndefined();
        });
    });

    describe('custom fields and templates', () => {
        test('should handle custom fields in token request', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client with custom fields
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials with Custom Fields',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/{{tenant}}/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        customFields: {
                            resource: '{{resource}}',
                            audience: '{{audience}}',
                            tenant_id: '{{tenant}}',
                        },
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint and verify custom fields
            example
                .post('/mytenant123/token')
                .reply(200, (uri, requestBody) => {
                    // Verify custom fields were sent in request
                    expect(requestBody).toContain('resource=https://api.example.com');
                    expect(requestBody).toContain('audience=https://api.example.com');
                    expect(requestBody).toContain('tenant_id=mytenant123');
                    return {
                        access_token: accessToken,
                        expires_in: 3600,
                        scope,
                        token_type: 'Bearer',
                    };
                });

            // Create secret with client credentials and input fields
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret with Custom Fields',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                            inputFields: {
                                resource: 'https://api.example.com',
                                audience: 'https://api.example.com',
                                tenant: 'mytenant123',
                            },
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.type).toBe(OA2_CLIENT_CREDENTIALS);
            expect(secret.value.accessToken).toBe(accessToken);
            expect(secret.value.inputFields).toBeDefined();
            expect(secret.value.inputFields.resource).toBe('https://api.example.com');
        });

        test('should handle missing required custom fields appropriately', async () => {
            const scope = 'foo bar';
            conf.crypto.isDisabled = true;

            // create auth client with required custom fields
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials with Required Fields',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://example.com/{{tenant}}/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        customFields: {
                            resource: '{{resource}}',
                            tenant_id: '{{tenant}}',
                        },
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Attempt to create secret without required input fields
            const errorResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret Missing Fields',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                            // Missing inputFields
                        },
                    },
                })
                .expect(400);

            expect(errorResponse.body.message).toContain('required');

            // Verify no secret was created
            const secret = await SecretDAO.findByAuthClient(authClient._id);
            expect(secret).toBeNull();
        });

        test('should handle template variables in endpoints', async () => {
            const scope = 'foo bar';
            const accessToken = 'test_access_token';
            conf.crypto.isDisabled = true;

            const example = nock('https://example.com');

            // create auth client with templated endpoints
            const authClient = (await request.post('/auth-clients')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Example Client Credentials with Templates',
                        type: OA2_CLIENT_CREDENTIALS,
                        endpoints: {
                            token: 'https://{{region}}.example.com/{{tenant}}/oauth2/v2.0/token',
                        },
                        clientId: 'client123',
                        clientSecret: 'secret456',
                        owners: [
                            {
                                id: 'u2',
                                type: 'USER',
                            },
                        ],
                    },
                })
                .expect(200)).body.data;

            // Mock token endpoint with expected template values
            example
                .post('/westus/mytenant/oauth2/v2.0/token')
                .reply(200, {
                    access_token: accessToken,
                    expires_in: 3600,
                    scope,
                    token_type: 'Bearer',
                });

            // Create secret with template values
            const secretResponse = await request.post('/secrets')
                .set(...global.userAuth1)
                .send({
                    data: {
                        name: 'Client Credentials Secret with Templates',
                        type: OA2_CLIENT_CREDENTIALS,
                        value: {
                            authClientId: authClient._id,
                            scope,
                            inputFields: {
                                region: 'westus',
                                tenant: 'mytenant',
                            },
                        },
                    },
                })
                .expect(200);

            const secret = secretResponse.body.data;
            expect(secret.type).toBe(OA2_CLIENT_CREDENTIALS);
            expect(secret.value.accessToken).toBe(accessToken);
            expect(secret.value.inputFields.region).toBe('westus');
        });
    });
});
