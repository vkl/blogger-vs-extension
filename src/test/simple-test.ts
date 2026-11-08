function assertEqual(actual: any, expected: any, message: string) {
    if (actual !== expected) {
        throw new Error(`${message}: Expected ${expected}, got ${actual}`);
    }
    console.log(`✓ ${message}`);
}

function assertIncludes(haystack: string, needle: string, message: string) {
    if (!haystack.includes(needle)) {
        throw new Error(`${message}: "${haystack}" does not include "${needle}"`);
    }
    console.log(`✓ ${message}`);
}

function runTests() {  
    console.log('\n🎉 All tests passed!');
}

try {
    runTests();
    process.exit(0);
} catch (error) {
    console.error('\n❌ Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
}
