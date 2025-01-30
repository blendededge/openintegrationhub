const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema(
    {
        // Unique identifier for this execution
        executionId: {
            type: String,
            unique: true,
            required: true,
            index: true
        },
        // Reference to flow execution
        flowExecId: {
            type: String,
            required: true,
            index: true
        },
        // Current state in the state machine
        currentState: {
            type: String,
            required: true
        },
        // Track individual step executions
        stepExecutions: [{
            stepId: {
                type: String,
                required: true
            },
            counterUpdated: {
                type: Boolean,
                default: false
            },
            messageSent: {
                type: Boolean,
                default: false
            },
            completedAt: {
                type: Date
            },
            error: Schema.Types.Mixed
        }],
        // States that have been started with their completion status
        stateHistory: [{
            state: {
                type: String,
                required: true
            },
            startedAt: {
                type: Date,
                required: true
            },
            completedAt: {
                type: Date
            },
            error: Schema.Types.Mixed
        }],
        // Input message that triggered this execution
        inputMessage: Schema.Types.Mixed,
        // Overall execution status
        isCompleted: {
            type: Boolean,
            default: false
        },
        // When the execution was completed
        completedAt: {
            type: Date,
            expires: '7d' // TTL index: Remove document 7 days after completion
        }
    },
    {
        timestamps: true
    }
);

// Indexes
schema.index({ flowExecId: 1, currentState: 1 });
schema.index({ completedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // Backup TTL index
schema.index({ 'stepExecutions.stepId': 1 });

class ExecutionStateDao {
    static async createExecution({ executionId, flowExecId, currentState, inputMessage }) {
        return this.create({
            executionId,
            flowExecId,
            currentState,
            stateHistory: [{
                state: currentState,
                startedAt: new Date()
            }],
            stepExecutions: [],
            inputMessage,
            isCompleted: false
        });
    }

    static async updateState({ executionId, currentState }) {
        return this.findOneAndUpdate(
            { executionId },
            { 
                $set: { currentState },
                $push: { 
                    stateHistory: {
                        state: currentState,
                        startedAt: new Date()
                    }
                }
            },
            { new: true }
        );
    }

    static async completeState({ executionId, state }) {
        return this.findOneAndUpdate(
            { 
                executionId,
                'stateHistory.state': state,
                'stateHistory.completedAt': { $exists: false }
            },
            { 
                $set: { 
                    'stateHistory.$.completedAt': new Date()
                }
            },
            { new: true }
        );
    }

    static async initializeStepExecution({ executionId, stepId }) {
        return this.findOneAndUpdate(
            { executionId },
            {
                $push: {
                    stepExecutions: {
                        stepId,
                        counterUpdated: false,
                        messageSent: false
                    }
                }
            },
            { new: true }
        );
    }

    static async markStepCounterUpdated({ executionId, stepId }) {
        return this.findOneAndUpdate(
            {
                executionId,
                'stepExecutions.stepId': stepId
            },
            {
                $set: {
                    'stepExecutions.$.counterUpdated': true
                }
            },
            { new: true }
        );
    }

    static async markStepMessageSent({ executionId, stepId }) {
        return this.findOneAndUpdate(
            {
                executionId,
                'stepExecutions.stepId': stepId
            },
            {
                $set: {
                    'stepExecutions.$.messageSent': true,
                    'stepExecutions.$.completedAt': new Date()
                }
            },
            { new: true }
        );
    }

    static async isStepCompleted({ executionId, stepId }) {
        const execution = await this.findOne({
            executionId,
            stepExecutions: {
                $elemMatch: {
                    stepId,
                    counterUpdated: true,
                    messageSent: true,
                    completedAt: { $exists: true }
                }
            }
        });
        return !!execution;
    }

    static async isStepCounterUpdated({ executionId, stepId }) {
        const execution = await this.findOne({
            executionId,
            stepExecutions: {
                $elemMatch: {
                    stepId,
                    counterUpdated: true
                }
            }
        });
        return !!execution;
    }

    static async isStepMessageSent({ executionId, stepId }) {
        const execution = await this.findOne({
            executionId,
            stepExecutions: {
                $elemMatch: {
                    stepId,
                    messageSent: true
                }
            }
        });
        return !!execution;
    }

    static async markCompleted({ executionId }) {
        const now = new Date();
        return this.findOneAndUpdate(
            { executionId },
            { 
                $set: { 
                    isCompleted: true,
                    completedAt: now
                }
            },
            { new: true }
        );
    }

    static async markStepError({ executionId, stepId, error }) {
        const now = new Date();
        return this.findOneAndUpdate(
            {
                executionId,
                'stepExecutions.stepId': stepId
            },
            {
                $set: {
                    'stepExecutions.$.error': error,
                    'stepExecutions.$.completedAt': now
                }
            },
            { new: true }
        );
    }

    static async findExecution(executionId) {
        return this.findOne({ executionId });
    }

    static async findByFlowExecId(flowExecId) {
        return this.find({ flowExecId });
    }
}

schema.loadClass(ExecutionStateDao);

const ExecutionStateModel = mongoose.model('execution-state', schema);

module.exports = ExecutionStateModel; 