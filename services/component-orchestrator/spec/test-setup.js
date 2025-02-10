const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

let replSet;

// Suppress the reserved schema pathname warning
mongoose.set('strictQuery', true);

before(async function() {
    this.timeout(60000); // Even longer timeout for initial setup

    // Close any existing connections
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    // Create new instance of MongoMemoryReplSet with 1 replica
    replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' }
    });

    const uri = replSet.getUri();

    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000, // Add connection timeout
            maxPoolSize: 10,         // Limit pool size
            minPoolSize: 1           // Ensure at least one connection
        });
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
});

// Clean up after each test suite
afterEach(async function() {
    this.timeout(10000);
    try {
        // Check connection state and reconnect if needed
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(replSet.getUri());
        }

        const collections = await mongoose.connection.db.collections();
        await Promise.all(
            collections.map(collection => collection.deleteMany({}))
        );
    } catch (err) {
        console.warn('Collection cleanup warning:', err);
        // Try to reconnect on next test
        await mongoose.disconnect();
    }
});

// Proper cleanup after all tests
after(async function() {
    this.timeout(60000);
    try {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        if (replSet) {
            await replSet.stop();
        }
    } catch (err) {
        console.error('Cleanup error:', err);
    } finally {
        // Force exit after cleanup
        setTimeout(() => process.exit(0), 1000).unref();
    }
});

// Handle process termination
['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach(signal => {
    process.on(signal, async () => {
        try {
            await mongoose.disconnect();
            if (replSet) {
                await replSet.stop();
            }
            process.exit(0);
        } catch (err) {
            console.error('Termination error:', err);
            process.exit(1);
        }
    });
});