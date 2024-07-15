const moment = require('moment');
const authFlowManager = require('../../auth-flow-manager');
const AuthClientDAO = require('../../dao/auth-client');

module.exports = async function handleOAuth2Password(data) {
    const {
        authClientId, username, password, scope, name,
    } = data;

    const authClient = await AuthClientDAO.findById(authClientId);

    if (!authClient) {
        throw new Error('AuthClient not found');
    }

    const resolvedUsername = username || authClient.username;
    const resolvedPassword = password || authClient.password;
    const resolvedScope = scope || authClient.predefinedScope;

    const response = await authFlowManager.exchangeRequestPasswordFlow({
        authClient,
        username: resolvedUsername,
        password: resolvedPassword,
        scope: resolvedScope,
    });

    if (response.error || !response.access_token) {
        throw new Error(`Failed to get token: ${response.error || 'No token received'}`);
    }

    const {
        access_token, token_type, expires_in, refresh_token, scope: returnedScope,
    } = response;

    const expires = (expires_in !== undefined && !Number.isNaN(expires_in))
        ? moment().add(expires_in, 'seconds').format() : moment(1e15).format();

    return {
        owners: [],
        type: authClient.type,
        name,
        value: {
            authClientId: authClient._id,
            accessToken: access_token,
            tokenType: token_type,
            expires,
            refreshToken: refresh_token,
            scope: returnedScope,
            fullResponse: JSON.stringify(response),
        },
    };
};
