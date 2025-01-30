const { FlowStateModel: FlowStateDao, DuplicateMessage } = require('../../src/dao/FlowStateDao');
const { expect } = require('chai');

const flowId = '123';
const flowExecId = 'foobar';
const flowExecId2 = 'foobar2';

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

describe('FlowStateDao', () => {
    beforeEach(async () => {
        // Clean up before each test
        await FlowStateDao.deleteMany({});
        await DuplicateMessage.deleteMany({});
    });

    describe('With flowId and stepId', () => {
        it('should return true', async () => {
            const TOTAL_STEPS = 100;
            const steps = [...Array(TOTAL_STEPS + 1).keys()].slice(1);
            let started = [];
            let succeeded = [];
            const promises = [];

            while (steps.length > 0) {
                const newlyStarted = [];
                const newlySucceeded = [];
                if (steps.length === 1) {
                    newlyStarted.push(steps.pop());
                } else {
                    for (let i = 0; i < getRandomInt(steps.length); i++) {
                        newlyStarted.push(steps.pop());
                    }
                }

                for (let i = 0; i < getRandomInt(started.length); i++) {
                    newlySucceeded.push(started.pop());
                }

                promises.push(FlowStateDao.upsert(flowExecId, newlyStarted, newlySucceeded));

                started = started.concat(newlyStarted);
                succeeded = succeeded.concat(newlySucceeded);
            }

            await Promise.all(promises);

            // finish rest of started
            const { succeededNodes, startedNodes } = await FlowStateDao.upsert(flowExecId, [], started);

            expect(succeededNodes.length).to.equal(startedNodes.length);
            expect(succeededNodes.reduce((a, b) => a + b)).to.equal(startedNodes.reduce((a, b) => a + b));
        });
    });

    describe('Counted only', () => {
        it('should increment counters correctly', async () => {
            const TOTAL_STEPS = 100;
            const steps = [...Array(TOTAL_STEPS + 1).keys()].slice(1);
            let started = [];
            let succeeded = [];
            const promises = [];

            while (steps.length > 0) {
                const newlyStarted = [];
                const newlySucceeded = [];
                if (steps.length === 1) {
                    newlyStarted.push(steps.pop());
                } else {
                    for (let i = 0; i < getRandomInt(steps.length); i++) {
                        newlyStarted.push(steps.pop());
                    }
                }

                for (let i = 0; i < getRandomInt(started.length); i++) {
                    newlySucceeded.push(started.pop());
                }

                promises.push(
                    FlowStateDao.upsertCount(flowId, flowExecId2, newlyStarted.length, newlySucceeded.length)
                );

                started = started.concat(newlyStarted);
                succeeded = succeeded.concat(newlySucceeded);
            }

            await Promise.all(promises);

            // finish rest of started
            const results = await FlowStateDao.upsertCount(flowId, flowExecId2, 0, started.length);

            expect(results.started).to.equal(results.succeeded);
        });

        it('should preserve tenant field on updates', async () => {
            const testTenant = 'test-tenant-2';
            // Create initial state with tenant
            await FlowStateDao.upsertState('flow-1', 'exec-1', testTenant);

            // Update state
            const updated = await FlowStateDao.upsertCount('flow-1', 'exec-1', 0, 1, testTenant);
            expect(updated.tenant).to.equal(testTenant);
            expect(updated.started).to.equal(1);
            expect(updated.succeeded).to.equal(1);
        });
    });

    describe('Flow State Creation', () => {
        it('should create new flow state with correct defaults', async () => {
            const testTenant = 'test-tenant';
            const state = await FlowStateDao.upsertState('flow-1', 'exec-1', testTenant);

            expect(state.tenant).to.equal(testTenant);
            expect(state.started).to.equal(1);
            expect(state.succeeded).to.equal(0);
            expect(state.errors).to.equal(0);
            expect(state.startedNodes).to.be.an('array').that.is.empty;
            expect(state.succeededNodes).to.be.an('array').that.is.empty;
            expect(state.stepCounters).to.deep.equal({});
        });

        it('should not modify existing flow state on duplicate', async () => {
            const testTenant = 'test-tenant-2';

            // Create initial state
            await FlowStateDao.upsertState('flow-2', 'exec-2', testTenant);

            // Modify some values
            await FlowStateDao.upsertCount('flow-2', 'exec-2', 0, 1);

            // Try to create again
            const duplicate = await FlowStateDao.upsertState('flow-2', 'exec-2', 'different-tenant');

            // Should maintain original values
            expect(duplicate.tenant).to.equal(testTenant);
            expect(duplicate.succeeded).to.equal(1);
        });
    });

    describe('#findByFlowExecId', () => {
        beforeEach(async () => {
            // Ensure clean state and create test data
            await FlowStateDao.deleteMany({});
            await FlowStateDao.create({
                flowId: 'my-flow',
                flowExecId: 'my-exec',
                started: 1,
                succeeded: 1
            });
        });

        it('should not find exec that does not exist', async () => {
            const flowExec = await FlowStateDao.findByFlowExecId('temp123');
            expect(flowExec).to.be.null;
        });

        it('should find existing exec', async () => {
            const flowExec = await FlowStateDao.findByFlowExecId('my-exec');
            expect(flowExec).to.not.be.null;
            expect(flowExec.flowExecId).to.equal('my-exec');
        });
    });

    describe('#find', () => {
        beforeEach(async () => {
            // Ensure clean state and create test data
            await FlowStateDao.deleteMany({});
            await FlowStateDao.create({
                flowId: 'flow1',
                flowExecId: 'my-exec1',
                started: 1,
                succeeded: 1
            });
            await FlowStateDao.create({
                flowId: 'flow1',
                flowExecId: 'my-exec2',
                started: 1,
                succeeded: 1
            });
        });

        it('should find execs by flowId', async () => {
            const execs = await FlowStateDao.find({ flowId: 'flow1' });
            expect(execs).to.be.an('array');
            expect(execs.length).to.equal(2);
            expect(execs[0].flowExecId).to.equal('my-exec1');
            expect(execs[1].flowExecId).to.equal('my-exec2');
        });
    });

    describe('Duplicate Messages', () => {
        it('should track and retrieve duplicate messages', async () => {
            const testMessage = {
                flowExecId: 'test-flow',
                stepId: 'test-step',
                messageId: 'test-message',
                originalMessage: { test: 'data' }
            };

            await FlowStateDao.trackDuplicateMessage(
                testMessage.flowExecId,
                testMessage.stepId,
                testMessage.messageId,
                testMessage.originalMessage
            );

            const duplicates = await FlowStateDao.getDuplicateMessages('test-flow');
            expect(duplicates).to.have.lengthOf(1);
            expect(duplicates[0].messageId).to.equal('test-message');
        });

        it('should not create duplicate entries for same message', async () => {
            const testMessage = {
                flowExecId: 'test-flow-2',
                stepId: 'test-step',
                messageId: 'test-message',
                originalMessage: { test: 'data' }
            };

            // Try to insert same message twice
            await FlowStateDao.trackDuplicateMessage(
                testMessage.flowExecId,
                testMessage.stepId,
                testMessage.messageId,
                testMessage.originalMessage
            );

            await FlowStateDao.trackDuplicateMessage(
                testMessage.flowExecId,
                testMessage.stepId,
                testMessage.messageId,
                testMessage.originalMessage
            );

            const duplicates = await FlowStateDao.getDuplicateMessages('test-flow-2');
            expect(duplicates).to.have.lengthOf(1);
        });

        describe('#processStep', () => {
            const testFlow = {
                flowId: 'test-flow',
                flowExecId: 'test-exec',
                tenant: 'test-tenant'
            };

            beforeEach(async () => {
                await FlowStateDao.deleteMany({});
                await DuplicateMessage.deleteMany({});
                // Create initial flow state
                await FlowStateDao.upsertState(testFlow.flowId, testFlow.flowExecId, testFlow.tenant);
            });

            it('should process new message successfully', async () => {
                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                const result = await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step1',
                    'msg1',
                    messageData
                );

                expect(result).to.be.true;

                // Verify state was updated
                const state = await FlowStateDao.findOne({ flowExecId: testFlow.flowExecId });
                expect(state.stepCounters.step1.in).to.equal(1);
                expect(state.stepCounters.step1.messageId).to.equal('msg1');
                expect(state.stepCounters.step1.processedAt).to.be.instanceof(Date);
            });

            it('should detect and track duplicate messages', async () => {
                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                // Process first message
                const firstResult = await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step1',
                    'msg1',
                    messageData
                );

                // Try to process same message again
                const duplicateResult = await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step1',
                    'msg1',
                    messageData
                );

                expect(firstResult).to.be.true;
                expect(duplicateResult).to.be.false;

                // Verify duplicate was tracked
                const duplicates = await DuplicateMessage.find({
                    flowExecId: testFlow.flowExecId,
                    stepId: 'step1',
                    messageId: 'msg1'
                });

                expect(duplicates).to.have.lengthOf(1);
                expect(duplicates[0].originalMessage).to.deep.equal(messageData);
            });

            it('should handle concurrent message processing correctly', async () => {
                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                // Simulate concurrent processing of same message
                const results = await Promise.all([
                    FlowStateDao.processStep(testFlow.flowExecId, 'step1', 'msg1', messageData),
                    FlowStateDao.processStep(testFlow.flowExecId, 'step1', 'msg1', messageData),
                    FlowStateDao.processStep(testFlow.flowExecId, 'step1', 'msg1', messageData)
                ]);

                // Only one should succeed
                const successCount = results.filter(r => r === true).length;
                expect(successCount).to.equal(1);

                // Verify state was updated only once
                const state = await FlowStateDao.findOne({ flowExecId: testFlow.flowExecId });
                expect(state.stepCounters.step1.in).to.equal(1);
            });

            it('should not process message if flow state does not exist', async () => {
                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                const result = await FlowStateDao.processStep(
                    'nonexistent-exec',
                    'step1',
                    'msg1',
                    messageData
                );

                expect(result).to.be.false;

                // Verify no state was created
                const state = await FlowStateDao.findOne({ flowExecId: 'nonexistent-exec' });
                expect(state).to.be.null;
            });

            it('should handle multiple steps independently', async () => {
                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                // Process messages for different steps
                const step1Result = await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step1',
                    'msg1',
                    messageData
                );

                const step2Result = await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step2',
                    'msg1', // Same messageId but different step
                    messageData
                );

                expect(step1Result).to.be.true;
                expect(step2Result).to.be.true;

                // Verify both steps were updated
                const state = await FlowStateDao.findOne({ flowExecId: testFlow.flowExecId });
                expect(state.stepCounters.step1.in).to.equal(1);
                expect(state.stepCounters.step2.in).to.equal(1);
            });

            it('should preserve existing step counter values', async () => {
                // Set initial counter value
                await FlowStateDao.updateOne(
                    { flowExecId: testFlow.flowExecId },
                    { $set: { 'stepCounters.step1.customField': 'test' } }
                );

                const messageData = {
                    msg: { data: { test: 'data' } },
                    nodeProperties: { function: 'testFunc' }
                };

                await FlowStateDao.processStep(
                    testFlow.flowExecId,
                    'step1',
                    'msg1',
                    messageData
                );

                // Verify custom field was preserved
                const state = await FlowStateDao.findOne({ flowExecId: testFlow.flowExecId });
                expect(state.stepCounters.step1.customField).to.equal('test');
                expect(state.stepCounters.step1.in).to.equal(1);
            });
        });
    });
});
