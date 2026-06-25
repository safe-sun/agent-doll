const { readCodexUsage } = require("../src/usage-reader");

async function main() {
  const usage = await readCodexUsage();
  console.log(JSON.stringify(usage, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
