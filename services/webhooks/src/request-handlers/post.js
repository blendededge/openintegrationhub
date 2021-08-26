const { RequestHandlers } = require('@openintegrationhub/webhooks');

class PostRequestHandler extends RequestHandlers.Post {
    constructor(req, res, messagePublisher, apiClient) {
        super(req, res, messagePublisher);
        this.apiClient = apiClient;
    }

    async handle() {
        await this.authorize();
        super.handle();
    }

    async authorize() {
        return;
    }
}
module.exports.PostRequestHandler = PostRequestHandler;