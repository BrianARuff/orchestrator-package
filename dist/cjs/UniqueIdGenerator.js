"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UniqueIdGenerator = void 0;
const crypto_1 = require("crypto");
class UniqueIdGenerator {
    constructor() {
        // 6 bytes for node identity
        this.nodeId = (0, crypto_1.randomBytes)(6);
        // Process ID (or random if not available)
        this.processId = typeof process !== 'undefined'
            ? process.pid
            : Math.floor(Math.random() * 0xFFFF); // Use full 16 bits (65535)
        this.lastTimestamp = BigInt(0);
        this.counter = 0;
        // Custom epoch (e.g., project start date)
        this.epoch = BigInt(1672531200000); // 2023-01-01
    }
    generate() {
        let timestamp = BigInt(Date.now());
        // Ensure timestamp is after epoch
        timestamp = timestamp - this.epoch;
        // Handle same-millisecond collisions
        if (timestamp <= this.lastTimestamp) {
            this.counter++;
            // If counter overflows, spin until next millisecond
            if (this.counter > 4095) { // 12 bits
                do {
                    timestamp = BigInt(Date.now()) - this.epoch;
                } while (timestamp <= this.lastTimestamp);
                this.counter = 0;
            }
        }
        else {
            this.counter = 0;
        }
        this.lastTimestamp = timestamp;
        // Construct ID:
        // - 42 bits: timestamp
        // - 48 bits: node id
        // - 16 bits: process id
        // - 12 bits: sequence counter
        const timestampBits = timestamp.toString(16).padStart(11, '0');
        const nodeIdBits = this.nodeId.toString('hex');
        const processIdBits = this.processId.toString(16).padStart(4, '0');
        const counterBits = this.counter.toString(16).padStart(3, '0');
        return `${timestampBits}${nodeIdBits}${processIdBits}${counterBits}`;
    }
}
exports.UniqueIdGenerator = UniqueIdGenerator;
exports.default = UniqueIdGenerator;
//# sourceMappingURL=UniqueIdGenerator.js.map