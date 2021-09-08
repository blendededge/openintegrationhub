const { RequestHandlers } = require('@openintegrationhub/webhooks');
var crypto = require('crypto');
const { DEFAULT_HMAC_HEADER_KEY = 'x-hmac', HMAC_SECRET } = process.env;
const WEBHOOK_AUTH_TYPES = {
    HMAC: 'hmac',
    OIH_IAM: 'iam',
    BASIC: 'basic',
}

class PostRequestHandler extends RequestHandlers.Post {
    constructor(req, res, messagePublisher, apiClient) {
        super(req, res, messagePublisher);
        this.apiClient = apiClient;
        this.logger = this.getLogger();

    }

    async handle() {
        await this.authorize();
        super.handle();
    }

    async authorize() {
        // Has the first node of the flow been configured to enforce authentication?
        const flow = this.getFlow();
        const firstNode = flow.getFirstNode();
        this.logger.debug(`Flow ${flow.id} first step is: `, firstNode);
        // Default to false if field doesn't exist
        const { fields = { requireAuthorization: false, webhookAuthType: WEBHOOK_AUTH_TYPES.OIH_IAM }} = firstNode;
        if (!fields.requireAuthorization) {
            this.logger.debug('Not authenticating the flow. requireAuthorization is not enabled');
            return;
        }

        const { webhookAuthType } = fields;
        switch(webhookAuthType) {
            case WEBHOOK_AUTH_TYPES.BASIC:
                break;
            case WEBHOOK_AUTH_TYPES.HMAC:
                this.authenticateHmac(fields);
                break;
            case WEBHOOK_AUTH_TYPES.OIH_IAM:
                break;
            default:
                return DEFAULT_HMAC_HEADER_KEY;
        }
        return;
    }

    authenticateHmac(fields) {
        const { webhookHmacHeaderKey = DEFAULT_HMAC_HEADER_KEY } = fields;
        // Check for hmac header in the request
        const hmacHeaderValue = this._req.headers[webhookHmacHeaderKey];
        const expectedHmac = this.createHmac(JSON.stringify(this._req.rawBody), HMAC_SECRET)
        if (hmacHeaderValue !== expectedHmac) {
            throw Error('HMAC value did not match');
        }
        return true;
    }

    createHmac(data, privateKey) {
        const calculatedHmac = crypto.createHmac('sha256', privateKey)
        .update(data)
        .digest('base64');
        return calculatedHmac;
    }

    getHmacAuthHeaderValue({ headers, key }) {
        return key ? headers[key] : headers[DEFAULT_HMAC_HEADER_KEY];
    }
}
module.exports.PostRequestHandler = PostRequestHandler;