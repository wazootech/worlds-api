import { render } from "cfonts";
import type { ModelMessage } from "ai";
import { generateText, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createClient } from "@libsql/client";
import { createServer } from "#/server/server.ts";
import { createTestAccount } from "#/server/testing.ts";
import type { WorldsOptions } from "#/sdk/types.ts";
import { InternalWorldsSdk } from "#/sdk/internal/sdk.ts";
import { UniversalSentenceEncoderEmbeddings } from "#/server/embeddings/use.ts";
import { createWorldsKvdex } from "#/server/db/kvdex.ts";
import type { AppContext } from "#/server/app-context.ts";
import { createTools, formatPrompt } from "./tools.ts";
import systemPrompt from "./prompt.md" with { type: "text" };

/**
 * createExampleContext creates a custom app context for the example CLI.
 */
async function createExampleContext(): Promise<AppContext> {
  const kv = await Deno.openKv(":memory:");
  const db = createWorldsKvdex(kv);
  const apiKey = "admin-api-key";

  const libsqlClient = createClient({ url: ":memory:" });
  const embeddings = new UniversalSentenceEncoderEmbeddings();
  return {
    db,
    kv,
    libsqlClient,
    embeddings,
    admin: { apiKey },
  };
}

if (import.meta.main) {
  // Set up in-memory world.
  const appContext = await createExampleContext();
  const server = await createServer(appContext);
  const worldsOptions: WorldsOptions = {
    baseUrl: "http://localhost/v1",
    apiKey: appContext.admin!.apiKey!,
    fetch: (url, init) => server.fetch(new Request(url, init)),
  };

  const sdk = new InternalWorldsSdk(worldsOptions);

  const testAccount = await createTestAccount(appContext.db);
  const worldRecord = await sdk.worlds.create({
    label: "Test World",
    description: "Test World",
    isPublic: false,
  }, { accountId: testAccount.id });

  // Set up tools.
  const tools = createTools({
    ...worldsOptions,
    worldId: worldRecord.id,
  });

  // Set up AI.
  const messages: ModelMessage[] = [];
  const google = createGoogleGenerativeAI({
    apiKey: Deno.env.get("GOOGLE_API_KEY")!,
  });

  const renderResult = render("Worlds CLI", {
    font: "block",
    align: "left",
    colors: ["#d97706"],
    background: "transparent",
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: "0",
    gradient: ["#d97706", "#f59e0b"],
    independentGradient: true,
    transitionGradient: true,
    env: "node",
  });
  const banner = renderResult ? renderResult.string : "Worlds CLI";
  console.log(banner);
  console.log(
    "%cWelcome to Worlds CLI.%c Type 'exit' to quit.",
    "color: #78350f; font-weight: bold",
    "color: #6b7280",
  );

  // Run REPL.
  while (true) {
    const userInput = prompt(">");
    if (!userInput) {
      continue;
    }

    if (userInput.toLowerCase() === "exit") {
      break;
    }

    messages.push({
      role: "user",
      content: [{
        type: "text",
        text: formatPrompt({
          content: userInput,
          userIri: "https://etok.me/",
          date: new Date(),
        }),
      }],
    });

    // Pretrained to create sparql queries
    // Latent demand channel?
    const result = await generateText({
      model: google("gemini-2.5-flash-lite"),
      tools,
      system: systemPrompt,
      stopWhen: stepCountIs(100),
      messages,
    });

    for (const step of result.steps) {
      for (const call of step.toolCalls) {
        const toolResult = step.toolResults
          .find((r) => r.toolCallId === call.toolCallId);

        switch (call.toolName) {
          case "generateIri": {
            const styles = [
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
            ];
            if (toolResult?.output) {
              styles.push("color: #10b981");
            }

            console.log(
              `%cgenerateIri(%c${
                (call.input as { entityText?: string | undefined }).entityText
              }%c)${
                (toolResult?.output as { iri?: string | undefined }).iri
                  ? ` => %c${
                    (toolResult?.output as { iri?: string | undefined }).iri
                  }`
                  : ""
              }`,
              ...styles,
            );
            break;
          }

          case "executeSparql": {
            const styles = [
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
            ];
            if (toolResult?.output) {
              styles.push("color: #10b981");
            }

            console.log(
              `%cexecuteSparql(%c${
                (call.input as { sparql: string }).sparql.trim()
              }%c)${
                toolResult?.output
                  ? ` => %c${JSON.stringify(toolResult?.output)}`
                  : ""
              }`,
              ...styles,
            );
            break;
          }

          case "searchFacts": {
            const styles = [
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
            ];
            if (toolResult?.output) {
              styles.push("color: #10b981");
            }

            console.log(
              `%csearchFacts(%c${(call.input as { query: string }).query}%c)${
                toolResult?.output
                  ? ` => %c${JSON.stringify(toolResult?.output)}`
                  : ""
              }`,
              ...styles,
            );
            break;
          }
        }
      }
    }

    messages.push({
      role: "assistant",
      content: result.text,
    });

    console.log(`\n%c${result.text}`, "color: #10b981");

    messages.push(
      { role: "assistant", content: result.content } as ModelMessage,
    );
  }
}
