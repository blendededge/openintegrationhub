const mongoose = require('mongoose');
const owner = require('../schema/owner');
const field = require('../schema/field');
const requestConfig = require('../schema/requestConfig');

const {
    OA1_TWO_LEGGED,
    OA1_THREE_LEGGED,
    OA2_AUTHORIZATION_CODE,
    SESSION_AUTH,
    OA2_PASSWORD,
    OA2_CLIENT_CREDENTIALS,
} = require('../../constant').AUTH_TYPE;

const { Schema } = mongoose;

const authClientBaseSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    owners: {
        type: [owner],
        required: true,
    },
    preprocessor: String,
    tenant: String,
    type: {
        type: String,
        required: true,
    },
}, {
    timestamps: true,
});

const AuthClient = mongoose.model('auth-client', authClientBaseSchema);

module.exports = {
    full: AuthClient,
    [OA1_TWO_LEGGED]:
        AuthClient.discriminator(`C_${OA1_TWO_LEGGED}`, new Schema({
            consumerKey: {
                type: String,
                required: true,
            },
            consumerSecret: {
                type: String,
                required: true,
            },
            nonce: {
                type: String,
                required: true,
            },
            signature: {
                type: String,
                required: true,
            },
            signatureMethod: {
                type: String,
                required: true,
            },
            verifier: String,
        })),
    [OA1_THREE_LEGGED]:
        AuthClient.discriminator(`C_${OA1_THREE_LEGGED}`, new Schema({
            appName: String,
            key: {
                type: String,
                required: true,
            },
            secret: {
                type: String,
                required: true,
            },
            nonce: String,
            signature: String,
            signatureMethod: String,
            expiration: String,
            endpoints: {
                request: {
                    type: String,
                    required: true,
                },
                authorize: {
                    type: String,
                    required: true,
                },
                access: {
                    type: String,
                    required: true,
                },
            },
            redirectUri: {
                type: String,
                required: true,
            },
        })),
    [OA2_AUTHORIZATION_CODE]:
        AuthClient.discriminator(`A_${OA2_AUTHORIZATION_CODE}`, new Schema({
            clientId: {
                type: String,
                required: true,
            },
            clientSecret: {
                type: String,
                required: true,
            },
            redirectUri: {
                type: String,
                required: true,
            },
            refreshWithScope: {
                type: Boolean,
                required: false,
                default: false,
            },
            endpoints: {
                auth: {
                    type: String,
                    required: true,
                },
                token: {
                    type: String,
                    required: true,
                },
                userinfo: String,
                revocation: String,
                endSession: String,
            },
            predefinedScope: String,
        })),
    [OA2_PASSWORD]:
        AuthClient.discriminator(`A_${OA2_PASSWORD}`, new Schema({
            clientId: {
                type: String,
                required: true,
            },
            clientSecret: {
                type: String,
                required: true,
            },
            endpoints: {
                token: {
                    type: String,
                    required: true,
                },
            },
            includeCredentialsInHeader: {
                type: Boolean,
                default: false,
            },
            predefinedScope: String,
            username: String,
            password: String,
        })),
    [OA2_CLIENT_CREDENTIALS]:
        AuthClient.discriminator(`A_${OA2_CLIENT_CREDENTIALS}`, new Schema({
            clientId: {
                type: String,
                required: true,
            },
            clientSecret: {
                type: String,
                required: true,
            },
            endpoints: {
                token: {
                    type: String,
                    required: true,
                },
                revocation: String,
            },
            includeCredentialsInHeader: {
                type: Boolean,
                default: false,
                description: 'If true, credentials will be sent in Authorization header as Basic auth. If false, in request body.',
            },
            predefinedScope: String,
            customFields: {
                type: Map,
                of: String,
                description: 'Additional fields required by specific providers',
            },
        })),
    [SESSION_AUTH]:
        AuthClient.discriminator(`A_${SESSION_AUTH}`, new Schema({
            fields: {
                type: [field],
                required: true,
            },
            tokenPath: String,
            expirationPath: String,
            endpoints: {
                auth: {
                    type: requestConfig,
                    required: true,
                },
                verification: requestConfig,
            },
        })),
};
