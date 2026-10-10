globalThis.fetch=async()=>{throw new Error('Network access is disabled in E1 tests.');};
await import(process.env.LSA_OFFLINE_TEST_FILE);
