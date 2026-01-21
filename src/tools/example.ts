import figlet from "figlet";
import type { ModelMessage } from "ai";
import { generateText, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createServer } from "#/server/server.ts";
import { createTestAccount, createTestContext } from "#/server/testing.ts";
import type { WorldsOptions } from "#/sdk/types.ts";
import { InternalWorldsSdk } from "#/sdk/internal/sdk.ts";
import { createTools, formatPrompt } from "./tools.ts";
import systemPrompt from "./prompt.md" with { type: "text" };

if (import.meta.main) {
  // Set up in-memory world.
  const appContext = await createTestContext();
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

  console.log(
    `%c${figlet.textSync("Worlds CLI")}`,
    "color: #3b82f6; font-weight: bold",
  );
  console.log(
    "%cVisit our company page at %chttps://wazoo.tech/",
    "color: #6b7280",
    "color: #3b82f6; text-decoration: underline",
  );
  console.log(
    "%cRead the documentation at %chttps://docs.wazoo.tech/",
    "color: #6b7280",
    "color: #3b82f6; text-decoration: underline",
  );
  console.log(
    "%cOpen the web console at %chttps://console.wazoo.tech/",
    "color: #6b7280",
    "color: #3b82f6; text-decoration: underline",
  );
  console.log(
    "%cCheck out our GitHub at %chttps://github.com/wazootech/",
    "color: #6b7280",
    "color: #3b82f6; text-decoration: underline",
  );
  console.log(
    "%cWelcome to the Worlds CLI example.%c Type 'exit' to quit.",
    "color: #3b82f6; font-weight: bold",
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

    const result = await generateText({
      model: google("gemini-3-flash-preview"),
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
            console.log(
              `%c  generateIri(%c${
                (call.input as { entityText?: string | undefined }).entityText
              }%c)${
                (toolResult?.output as { iri?: string | undefined }).iri
                  ? ` => %c${
                    (toolResult?.output as { iri?: string | undefined }).iri
                  }`
                  : ""
              }`,
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
              "color: #10b981",
            );
            break;
          }

          case "executeSparql": {
            console.log(
              `%c  executeSparql(%c${
                (call.input as { sparql: string }).sparql.trim()
              }%c)${
                toolResult?.output
                  ? ` => %c${JSON.stringify(toolResult?.output)}`
                  : ""
              }`,
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
              "color: #10b981",
            );
            break;
          }

          case "searchFacts": {
            console.log(
              `%c  searchFacts(%c${(call.input as { query: string }).query}%c)${
                toolResult?.output
                  ? ` => %c${JSON.stringify(toolResult?.output)}`
                  : ""
              }`,
              "color: #94a3b8",
              "color: #cbd5e1",
              "color: #94a3b8",
              "color: #10b981",
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
