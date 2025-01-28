const fetch = require('node-fetch');
const { Headers } = require('node-fetch');
const dotProp = require('dot-prop');
const { OAuth } = require('oauth');

const logger = require('@basaas/node-logger');
const conf = require('../conf');
const { OA2_AUTHORIZATION_CODE, OA1_THREE_LEGGED, SESSION_AUTH, OA2_CLIENT_CREDENTIALS } = require('../constant').AUTH_TYPE;
const {
    HEADER_AUTH, BODY_AUTH, PARAMS_AUTH, FORM_AUTH,
} = require('../constant').AUTH_REQUEST_TYPE;
const defaultAdapter = require('../adapter/preprocessor/default');

const log = logger.getLogger(`${conf.log.namespace}/auth-flow-manager`);

class HTTPResponseError extends Error {
    constructor(response, ...args) {
        // eslint-disable-next-line no-this-before-super
        super(`HTTP Error Response: ${response.status} ${response.statusText}`, ...args);
        this.response = response;
    }
}

const checkStatus = (response) => {
    if (!response.ok) {
        throw new HTTPResponseError(response);
    } else {
        // response.status >= 200 && response.status < 300
        return response;
    }
};

// tools
// oauth

async function oauthGetAccess({ authClient, flow, queryObject }) {
    return new Promise((resolve, reject) => {
        const oauth = new OAuth(
            authClient.endpoints.request,
            authClient.endpoints.access,
            authClient.key,
            authClient.secret,
            '1.0A',
            authClient.redirectUri,
            'HMAC-SHA1',
        );
        const token = flow.requestToken;
        const tokenSecret = flow.requestTokenSecret;
        const verifier = queryObject.oauth_verifier;
        oauth.getOAuthAccessToken(token, tokenSecret, verifier, (error, accessToken, accessTokenSecret, results) => {
            if (error) {
                reject(error);
            } else {
                resolve({
                    accessToken, accessTokenSecret,
                });
            }
        });
    });
}

async function oauthGetAuthorize({ authClient, flow }) {
    return new Promise((resolve, reject) => {
        const oauth = new OAuth(
            authClient.endpoints.request,
            authClient.endpoints.accessL,
            authClient.key,
            authClient.secret,
            '1.0A',
            authClient.redirectUri,
            'HMAC-SHA1',
        );
        oauth.getOAuthRequestToken(async (error, token, tokenSecret, results) => {
            if (error) {
                reject(error);
            } else {
                flow.requestToken = token;
                flow.requestTokenSecret = tokenSecret;
                await flow.save();
                resolve(`${authClient.endpoints.authorize}?oauth_token=${token}&name=${authClient.appName}&scope=${flow.scope}&expiration=${authClient.expiration}`);
            }
        });
    });
}

// oauth2
async function requestHelper(url, form, headers = {}) {
    const params = new URLSearchParams();
    for (const property in form) {
        if (Object.prototype.hasOwnProperty.call(form, property)) {
            params.append(property, form[property]);
        }
    }
    /* fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
    })
        .then(checkStatus)
        .then((response) => response.json())
        .catch((error) => { throw new Error(error); }); */
    log.debug(`requestHelper: url: ${url} body params: ${params.toString()}`);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            ...headers,
        },
        body: params,
    });
    return checkStatus(response).json();
}

async function exchangeRequest(url, {
    code, clientId, clientSecret, redirectUri,
}) {
    return await requestHelper(url, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
    });
}

async function refreshRequest(url, {
    clientId, clientSecret, refreshToken, scope, includeCredentialsInHeader = false,
}) {
    const params = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    };

    if (scope) {
        params.scope = scope;
    }

    const headers = {};
    if (includeCredentialsInHeader) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    } else {
        params.client_id = clientId;
        params.client_secret = clientSecret;
    }

    return await requestHelper(url, params, headers);
}

const parsePath = (object, keys) => keys.split('.').reduce((o, k) => (o || {})[k], object);

const SUPPORTED_TOKEN_TYPES = ['Bearer', 'MAC', 'Basic'];

// TODO: When/if we provide a broader set of fields to be included, change the parsing from field-based
//          to string-based, replacing likely via Regex. Then can remove the hardcoded fields portion
const parseHandlebars = (inputValue, inputFields) => {
    if (!inputValue || !inputFields) return inputValue;
    let outputValue = inputValue;

    // Handle legacy format with fields. prefix
    if (inputValue.includes('{{fields.')) {
        for (const [key, value] of Object.entries(inputFields)) {
            outputValue = outputValue.replace(`{{fields.${key}}}`, value);
        }
        return outputValue;
    }

    // Handle new format without fields. prefix
    for (const [key, value] of Object.entries(inputFields)) {
        outputValue = outputValue.replace(`{{${key}}}`, value);
    }
    return outputValue;
};

async function clientCredentialsRequest(url, {
    clientId, clientSecret, scope, customFields = {}, includeCredentialsInHeader = false, inputFields = {}
}) {
    // Parse URL template if it contains variables
    const parsedUrl = parseHandlebars(url, inputFields);

    // Process custom fields with template variables
    const processedCustomFields = {};
    for (const [key, value] of Object.entries(customFields)) {
        processedCustomFields[key] = parseHandlebars(value, inputFields);
    }

    const params = {
        grant_type: 'client_credentials',
        ...(scope ? { scope } : {}),
        ...(!includeCredentialsInHeader ? { 
            client_id: clientId,
            client_secret: clientSecret,
        } : {}),
        ...processedCustomFields
    };

    const headers = {};
    if (includeCredentialsInHeader) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    }

    const response = await requestHelper(parsedUrl, params, headers);

    // Validate token type
    if (!response.token_type || !SUPPORTED_TOKEN_TYPES.includes(response.token_type)) {
        throw new Error(`Unsupported token type: ${response.token_type}. Supported types are: ${SUPPORTED_TOKEN_TYPES.join(', ')}`);
    }

    return response;
}

async function sessionRequest(url, {
    inputFields, authType, tokenPath, expirationPath, requestFields,
}) {
    let body = {};
    const headers = new Headers();
    switch (authType) {
    case PARAMS_AUTH: {
        const params = new URLSearchParams();
        requestFields.forEach((entry) => params.append(entry.key, encodeURI(parseHandlebars(entry.value, inputFields))));
        body = params;
        break;
    }
    case FORM_AUTH: {
        requestFields.forEach((entry) => body[entry.key] = parseHandlebars(entry.value, inputFields));
        headers.append('Content-Type', 'application/x-www-form-urlencoded');
        body = new URLSearchParams(body);
        break;
    }
    case BODY_AUTH:
        requestFields.forEach((entry) => body[entry.key] = parseHandlebars(entry.value, inputFields));
        headers.append('Content-Type', 'application/json');
        body = JSON.stringify(body);
        break;
    case HEADER_AUTH:
        requestFields.forEach((entry) => headers.append(entry.key, parseHandlebars(entry.value, inputFields)));
        break;
    default:
    }

    const parsedUrl = parseHandlebars(url, inputFields);
    try {
        const response = await fetch(parsedUrl, {
            method: 'POST',
            body,
            headers,
        });
        const obj = await checkStatus(response).json();
        return {
            access_token: parsePath(obj, tokenPath),
            expires_in: expirationPath ? parsePath(obj, expirationPath) : '',
        };
    } catch (error) {
        log.error(error);
        throw new Error(error);
    }
}

async function userinfoRequest(url, token) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
        },
    });
    return checkStatus(response).json();
}

async function revokeClientCredentials(authClient, secret) {
    if (!authClient.endpoints.revocation) {
        throw new Error('Revocation endpoint not configured for this auth client');
    }

    const parsedUrl = parseHandlebars(authClient.endpoints.revocation, secret.value.inputFields || {});
    
    const params = {
        token: secret.value.accessToken,
        token_type_hint: 'access_token',
        ...(authClient.customFields ? Object.fromEntries(
            Object.entries(authClient.customFields)
            .map(([k,v]) => [k, parseHandlebars(v, secret.value.inputFields || {})])
        ) : {})
    };

    const headers = {};
    if (authClient.includeCredentialsInHeader) {
        headers.Authorization = `Basic ${Buffer.from(`${authClient.clientId}:${authClient.clientSecret}`).toString('base64')}`;
    } else {
        params.client_id = authClient.clientId;
        params.client_secret = authClient.clientSecret;
    }

    try {
        const response = await fetch(parsedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                ...headers
            },
            body: new URLSearchParams(params)
        });

        // RFC 7009 specifies that the revocation endpoint should return 200 for valid tokens
        // and invalid tokens (to avoid token scanning attacks)
        if (response.status !== 200) {
            const error = await response.text();
            throw new Error(`Token revocation failed: ${error}`);
        }
    } catch (error) {
        log.error('Token revocation failed:', error);
        throw error;
    }
}

module.exports = {
    userinfoRequest,
    async start({
        authClient, flow, scope, state,
    }) {
        // create authorization request url
        switch (authClient.type) {
        case OA2_AUTHORIZATION_CODE:
            return authClient.endpoints.auth
                .replace('{{scope}}', encodeURI(
                    (authClient.predefinedScope ? `${authClient.predefinedScope} ` : '') + scope,
                ))
                .replace('{{state}}', encodeURI(state))
                .replace('{{redirectUri}}', encodeURI(authClient.redirectUri))
                .replace('{{clientId}}', encodeURI(authClient.clientId));
        case OA1_THREE_LEGGED:
            return await oauthGetAuthorize({
                authClient, flow,
            });
        case OA2_CLIENT_CREDENTIALS:
            throw new Error('Client Credentials grant type does not support authorization flow. Please create a secret directly.');
        default:
        }
    },
    async continue({
        authClient, code, flow, queryObject,
    }) {
        const {
            clientId, clientSecret, redirectUri,
        } = authClient;

        switch (authClient.type) {
        case OA2_AUTHORIZATION_CODE:
            return await exchangeRequest(authClient.endpoints.token, {
                code,
                clientId,
                clientSecret,
                redirectUri,
            });
        case OA1_THREE_LEGGED:
            return await oauthGetAccess({
                authClient, flow, queryObject,
            });
        default:
        }
    },
    async refresh(authClient, secret) {
        log.debug(`Refreshing auth ${secret && secret._id ? secret._id : ''} client id: ${authClient && authClient._id ? authClient._id : ''}`);
        switch (authClient.type) {
        case OA2_AUTHORIZATION_CODE: {
            const { clientId, clientSecret, refreshWithScope, includeCredentialsInHeader } = authClient;
            const { refreshToken, scope } = secret.value;
            const combinedScope = (authClient.predefinedScope ? `${authClient.predefinedScope} ` : '') + scope;
            return await refreshRequest(authClient.endpoints.token, {
                clientId,
                clientSecret,
                refreshToken,
                includeCredentialsInHeader,
                ...(refreshWithScope ? { scope: combinedScope } : {}),
            });
        }
        case SESSION_AUTH: {
            const { tokenPath } = authClient;
            const { expirationPath } = authClient;
            const { authType, url, requestFields } = authClient.endpoints.auth;
            const { inputFields } = secret.value;

            return await sessionRequest(url, {
                inputFields,
                authType,
                tokenPath,
                expirationPath,
                requestFields,
            });
        }
        case OA2_CLIENT_CREDENTIALS: {
            return await clientCredentialsRequest(authClient.endpoints.token, {
                clientId: authClient.clientId,
                clientSecret: authClient.clientSecret,
                scope: authClient.predefinedScope,
                customFields: authClient.customFields ? Object.fromEntries(authClient.customFields) : {},
                includeCredentialsInHeader: authClient.includeCredentialsInHeader,
                inputFields: secret.value.inputFields || {}
            });
        }
        default:
        }
    },

    async preprocessSecret({
        flow, authClient, secret, tokenResponse, localMiddleware,
    }) {
        if (authClient.preprocessor) {
            const adapter = dotProp.get(localMiddleware, authClient.preprocessor);
            if (!adapter) {
                throw (new Error(`Missing preprocessor ${authClient.preprocessor}`));
            }
            return await adapter({
                flow, authClient, secret, tokenResponse,
            });
        }
        // use default preprocessor
        return await defaultAdapter({
            flow, authClient, secret, tokenResponse,
        });
    },

    async exchangeRequestPasswordFlow({
        authClient, username, password, scope,
    }) {
        const params = {
            grant_type: 'password',
            username,
            password,
        };

        if (scope) {
            params.scope = scope;
        }

        const headers = {};

        if (authClient.includeCredentialsInHeader) {
            headers.Authorization = `Basic ${Buffer.from(`${authClient.clientId}:${authClient.clientSecret}`).toString('base64')}`;
        } else {
            params.client_id = authClient.clientId;
            params.client_secret = authClient.clientSecret;
        }

        return await requestHelper(authClient.endpoints.token, params, headers);
    },

    async exchangeClientCredentials({
        authClient, inputFields = {}, scope = ''
    }) {
        if (authClient.type !== OA2_CLIENT_CREDENTIALS) {
            throw new Error('Auth client type must be OA2_CLIENT_CREDENTIALS');
        }

        return await clientCredentialsRequest(authClient.endpoints.token, {
            clientId: authClient.clientId,
            clientSecret: authClient.clientSecret,
            scope: (authClient.predefinedScope ? `${authClient.predefinedScope} ` : '') + scope,
            customFields: authClient.customFields ? Object.fromEntries(authClient.customFields) : {},
            includeCredentialsInHeader: authClient.includeCredentialsInHeader,
            inputFields
        });
    },

    revokeClientCredentials,
};
