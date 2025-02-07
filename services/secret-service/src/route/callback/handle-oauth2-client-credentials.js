const moment = require('moment');
const log = require('@basaas/node-logger');
const authFlowManager = require('../../auth-flow-manager');
const AuthClientDAO = require('../../dao/auth-client');
const conf = require('../../conf');

const logger = log.getLogger(`${conf.log.namespace}/handle-oauth2-client-credentials`);

module.exports = async function handleOAuth2ClientCredentials(data) {
    // Extract from data.value if present
    const authClientId = (data.value && data.value.authClientId) || data.authClientId;
    const scope = (data.value && data.value.scope) || data.scope;
    const inputFields = (data.value && data.value.inputFields) || data.inputFields;
    const { name, owners } = data;

    // Add debug logging
    logger.debug('Looking up auth client with ID:', authClientId);

    const authClient = await AuthClientDAO.findById(authClientId);
    if (!authClient) {
        logger.error('Auth client not found for ID:', authClientId);
        throw new Error('Auth client not found');
    }

    logger.debug('Found auth client:', authClient._id);

    const response = await authFlowManager.exchangeClientCredentials({
        authClient,
        inputFields,
        scope,
    });

    if (response.error || !response.access_token) {
        throw new Error(`Failed to get token: ${response.error || 'No token received'}`);
    }

    return {
        owners,
        type: authClient.type,
        name,
        value: {
            authClientId: authClient._id,
            accessToken: response.access_token,
            tokenType: response.token_type,
            expires: response.expires_in ? moment().add(response.expires_in, 'seconds').format() : undefined,
            scope: response.scope,
            fullResponse: JSON.stringify(response),
            inputFields,
        },
    };
};
