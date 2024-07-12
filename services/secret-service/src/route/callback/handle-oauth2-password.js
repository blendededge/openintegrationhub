const moment = require('moment');
const find = require('lodash/find');
const logger = require('@basaas/node-logger');
const authFlowManager = require('../../auth-flow-manager');
const SecretDAO = require('../../dao/secret');
const { ROLE } = require('../../constant');
const conf = require('../../conf');
const { getKey } = require('../../middleware/key');

const log = logger.getLogger(`${conf.log.namespace}/callback/handle-oauth2`);

module.exports = async function handleOAuth2Password({
    req,
    authClient,
    username,
    password,
    scope,
    creator,
}) {
    const response = await authFlowManager.exchangeRequestPasswordFlow({
        authClient, username, password, scope,
    });

    if (response.error || !response.access_token) {
        throw new Error(`Failed to get token: ${response.error || 'No token received'}`);
    }

    let modifiedSecret = null;
    // fetch key
    const key = await getKey(req);

    const {
        access_token, token_type, expires_in, refresh_token, scope: returnedScope,
    } = response;

    const expires = (expires_in !== undefined && !Number.isNaN(expires_in))
        ? moment().add(expires_in, 'seconds').format() : moment(1e15).format();

    let secret = {
        owners: [{
            id: creator,
            type: ROLE.USER,
        }],
        type: authClient.type,
        value: {
            authClientId: authClient._id,
            accessToken: access_token,
            tokenType: token_type,
            expires,
            refreshToken: refresh_token,
            scope: returnedScope,
            fullResponse: response,
        },
    };

    secret = await authFlowManager.preprocessSecret({
        authClient,
        secret,
        tokenResponse: response,
        localMiddleware: req.app.locals.middleware,
    });

    // try to find secret by external id to prevent duplication
    const _secret = await SecretDAO.findByExternalId(
        secret.value.externalId,
        authClient._id,
    );

    if (_secret) {
        const updateValues = {
            id: _secret._id,
            data: {
                value: {
                    scope: returnedScope,
                    expires,
                    refreshToken: refresh_token,
                    accessToken: access_token,
                },
            },
        };

        if (!find(_secret.owners, { id: creator })) {
            updateValues.data.owners = _secret.owners;
            updateValues.data.owners.push({
                id: creator,
                type: ROLE.USER,
            });
        }

        modifiedSecret = await SecretDAO.update(updateValues, key);
    } else {
        // create new secret
        modifiedSecret = await SecretDAO.create(secret, key);
    }

    return {
        data: {
            secretId: modifiedSecret._id,
        },
    };
};
