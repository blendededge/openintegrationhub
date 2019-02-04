const mongoose = require('mongoose');
const owners = require('../schema/owners');

const { OA1_TWO_LEGGED, OA2_AUTHORIZATION_CODE, EXTERNAL_SOURCE } = require('../../constant').AUTH_TYPE;

const { Schema } = mongoose;

const authClientBaseSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    owners: {
        type: [owners],
        required: true,
    },
    type: {
        type: String,
        enum: [OA1_TWO_LEGGED, OA2_AUTHORIZATION_CODE],
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
            mappings: {
                externalId: {
                    source: {
                        type: String,
                        enum: EXTERNAL_SOURCE,
                        required: true,
                    },
                    key: {
                        type: String,
                        required: true,
                    },
                },
            },
        })),
};
