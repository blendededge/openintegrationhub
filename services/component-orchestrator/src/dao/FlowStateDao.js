const mongoose = require('mongoose');
const { Schema } = mongoose;
const logger = require('bunyan').createLogger({ name: 'flow-state-dao' });

// Schema for tracking duplicate messages
const duplicateMessageSchema = new Schema(
    {
        flowExecId: {
            type: String,
            required: true,
            index: true,
        },
        stepId: {
            type: String,
            required: true,
        },
        messageId: {
            type: String,
            required: true,
        },
        // Store original message for debugging
        originalMessage: {
            type: Schema.Types.Mixed,
            required: true,
        },
        detectedAt: {
            type: Date,
            default: Date.now,
            // TTL index to auto-delete after 7 days
            expires: 7 * 24 * 60 * 60
        }
    },
    {
        timestamps: true,
    }
);

// Create compound index for duplicate message lookups
duplicateMessageSchema.index(
    { flowExecId: 1, stepId: 1, messageId: 1 },
    { unique: true, background: true }
);

const DuplicateMessage = mongoose.model('duplicate-message', duplicateMessageSchema);

const schema = new Schema(
    {
        flowExecId: {
            type: String,
            unique: true,
            index: true,
        },
        flowId: {
            type: String,
            index: true,
        },
        tenant: {
            type: String,
            index: true,
        },
        started: {
            type: Number,
            required: true,
            default: 0,
        },
        succeeded: {
            type: Number,
            required: true,
            default: 0,
        },
        errors: {
            type: Number,
            default: 0,
        },
        stepCounters: {
            type: Schema.Types.Mixed,
            default: {},
        },
        startedNodes: {
            type: [],
            required: true,
            default: [],
        },
        succeededNodes: {
            type: [],
            required: true,
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

// Add compound index for message deduplication lookups
schema.index({
    'flowExecId': 1,
    'stepCounters.$.messageId': 1
}, {
    name: 'flowExecId_messageId',
    // Expire message tracking after 24 hours
    expireAfterSeconds: 24 * 60 * 60,
    // Make sparse to only index documents that have messageId
    sparse: true,
    // Add background indexing to not block operations
    background: true
});

class FlowStateDao {
    static async delete(flowExecId) {
        return this.deleteOne({
            flowExecId,
        });
    }

    static async upsertCount(flowId, flowExecId, incrementStarted, incrementSucceeded) {
        try {
            const state = await this.findOneAndUpdate(
                {
                    flowId,
                    flowExecId,
                },
                {
                    $inc: {
                        started: incrementStarted,
                        succeeded: incrementSucceeded,
                    },
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                }
            ).lean();
            return state;
        } catch (err) {
            // retry on duplicate error
            if (err.code === 11000) {
                return this.upsertCount(flowId, flowExecId, incrementStarted, incrementSucceeded);
            }
            throw err;
        }
    }

    static async upsertState(flowId, flowExecId, tenant) {
        try {
            const state = await this.findOneAndUpdate(
                {
                    flowId,
                    flowExecId,
                },
                {
                    $setOnInsert: {
                        tenant,
                        started: 1,
                        succeeded: 0,
                        errors: 0,
                        startedNodes: [],
                        succeededNodes: [],
                        stepCounters: {}
                    }
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                }
            ).lean();
            return state;
        } catch (err) {
            // retry on duplicate error
            if (err.code === 11000) {
                return this.upsertState(flowId, flowExecId, tenant);
            }
            throw err;
        }
    }

    static async upsert(flowExecId, started, succeeded) {
        try {
            const state = await this.findOneAndUpdate(
                {
                    flowExecId,
                },
                {
                    $push: {
                        startedNodes: {
                            $each: started,
                        },
                        succeededNodes: {
                            $each: succeeded,
                        },
                    },
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                }
            ).lean();
            return state;
        } catch (err) {
            // retry on duplicate error
            if (err.code === 11000) {
                return this.upsert(flowExecId, started, succeeded);
            }
            throw err;
        }
    }

    static async findByFlowExecId(flowExecId) {
        return this.findOne({ flowExecId });
    }

    // Monitoring queries
    static async getDuplicateMessageStats(startDate, endDate) {
        const match = {
            createdAt: {
                $gte: startDate,
                $lte: endDate
            }
        };

        return DuplicateMessage.aggregate([
            { $match: match },
            {
                $group: {
                    _id: {
                        flowExecId: '$flowExecId',
                        stepId: '$stepId'
                    },
                    count: { $sum: 1 },
                    firstOccurrence: { $min: '$createdAt' },
                    lastOccurrence: { $max: '$createdAt' }
                }
            },
            {
                $project: {
                    _id: 0,
                    flowExecId: '$_id.flowExecId',
                    stepId: '$_id.stepId',
                    count: 1,
                    firstOccurrence: 1,
                    lastOccurrence: 1,
                    timeSpan: {
                        $subtract: ['$lastOccurrence', '$firstOccurrence']
                    }
                }
            },
            { $sort: { count: -1 } }
        ]);
    }

    // Track duplicate message
    static async trackDuplicateMessage(flowExecId, stepId, messageId, originalMessage) {
        try {
            await DuplicateMessage.create({
                flowExecId,
                stepId,
                messageId,
                originalMessage
            });
        } catch (err) {
            if (err.code !== 11000) { // Ignore duplicate key errors
                throw err;
            }
        }
    }

    // Get duplicate messages for a flow
    static async getDuplicateMessages(flowExecId, options = {}) {
        const query = { flowExecId };
        if (options.stepId) {
            query.stepId = options.stepId;
        }

        return DuplicateMessage.find(query)
            .sort({ detectedAt: -1 })
            .limit(options.limit || 100)
            .lean();
    }

    /**
     * Process a step message with transaction support to ensure atomic operations
     * @param {string} flowExecId - The flow execution ID
     * @param {string} stepId - The step ID
     * @param {string} messageId - The message ID
     * @param {Object} messageData - The message data to store if duplicate
     * @returns {Promise<boolean>} - Returns true if message was processed, false if duplicate
     */
    static async processStep(flowExecId, stepId, messageId, messageData) {
        const session = await mongoose.startSession();
        try {
            let wasProcessed = false;
            await session.withTransaction(async () => {
                // First check if flow state exists and has tenant
                const flowState = await this.findOne({
                    flowExecId,
                    tenant: { $exists: true }
                }).session(session);

                if (!flowState) {
                    // Flow state doesn't exist or has no tenant
                    return false;
                }

                // Check for existing message with proper index
                const existing = await this.findOne({
                    flowExecId,
                    [`stepCounters.${stepId}.messageId`]: messageId
                }).session(session);

                if (existing) {
                    // Track duplicate message but don't block if tracking fails
                    try {
                        await this.trackDuplicateMessage(flowExecId, stepId, messageId, messageData);
                    } catch (err) {
                        // Log error but continue processing
                        logger.error({err, flowExecId, stepId, messageId}, 'Failed to track duplicate message');
                    }
                    return false;
                }

                // Update step counters atomically
                await this.updateOne(
                    { flowExecId },
                    {
                        $inc: { [`stepCounters.${stepId}.in`]: 1 },
                        $set: {
                            [`stepCounters.${stepId}.messageId`]: messageId,
                            [`stepCounters.${stepId}.processedAt`]: new Date()
                        }
                    },
                    {
                        session,
                        // Don't allow upsert - flow state must exist
                        upsert: false
                    }
                );

                wasProcessed = true;
                return true;
            });

            return wasProcessed;
        } finally {
            await session.endSession();
        }
    }
}

schema.loadClass(FlowStateDao);

const FlowStateModel = mongoose.model('flow-state', schema);

module.exports = {
    FlowStateModel,
    DuplicateMessage
};
