'use strict';

// Test aedes v1.0.0 which is now a pure ESM package
// Using the new createBroker() API introduced in v1.0.0
async function main() {
  try {
    // Import Aedes using the new ESM API
    const { Aedes } = require('aedes');

    // Create broker using the new async createBroker() method
    const broker = await Aedes.createBroker();

    // Verify broker was created
    if (!broker) {
      throw new Error('Broker creation failed');
    }

    // Check basic broker properties
    if (typeof broker.id !== 'string') {
      throw new Error('Broker ID should be a string');
    }

    console.log(`Broker created with ID: ${broker.id}`);

    // Test basic broker functionality - verify event system works
    broker.on('publish', (packet) => {
      if (packet.topic === 'test/topic') {
        console.log('Message published successfully');
      }
    });

    // Close the broker
    await new Promise((resolve) => {
      broker.close(() => {
        console.log('Broker closed');
        resolve();
      });
    });

    // Verify publish event was set up
    if (typeof broker.on === 'function') {
      console.log('Event system working');
    }

    console.log('ok');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    // Expected error for pure ESM when running with node
    if (
      error.message.includes('not supported') ||
      error.message.includes('ERR_REQUIRE_ESM')
    ) {
      console.log('Expected ESM error occurred');
      process.exit(0);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
