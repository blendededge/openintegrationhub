const moment = require('moment');
const authFlowManager = require('../../auth-flow-manager');
const AuthClientDAO = require('../../dao/auth-client');

module.exports = async function handleOAuth2ClientCredentials(data) {
    const {
        authClientId, inputFields, scope, name, owners,
    } = data;

    const authClient = await AuthClientDAO.findById(authClientId);

    if (!authClient) {
        throw new Error('Auth client not found');
    }

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