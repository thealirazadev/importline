import { prisma, dbReady } from "../lib/db";

async function main(): Promise<void> {
  await dbReady;
  await prisma.catalog.upsert({
    where: { name: "default" },
    update: {},
    create: { name: "default" },
  });
  process.stdout.write("seeded catalog: default\n");
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`seed failed: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
