# LSA Enhanced

**Los Santos Alive with characters that have more to say — and more to remember.**

An extension for **GTA V Enhanced** built on **Los Santos Alive Essential Hotfix #3**. It adds Luna-powered conversation, persistent NPC identities, memory, world awareness and more natural speech. Essential still handles the actual NPCs, actions and playback.

## What it does

- **Talk to NPCs.** Use your mic or type. Luna handles the conversation; OpenAI transcription and ElevenLabs or OpenAI speech handle the voice.
- **Keep characters around.** Promote an NPC, give them a profile, summon them later and pick up a conversation with the same character.
- **Remember things.** Conversation history and selected facts live in SQLite. NPCs can recall names and past events, and you can correct or forget memories.
- **Notice the world.** Characters can draw on witnessed gunfire, crashes, injuries and the music playing on the radio. The Scene Director can also trigger short, context-based remarks without being asked.
- **Do things together.** Follow, wait, sit and other existing Essential interactions work through the game's native behavior. More physical activities are on the roadmap.
- **Feel present.** Talk targeting, mic feedback, character-specific voices and expressive delivery are in place. Gestures and mouth animation are optional experiments.

## Where it's at

The core conversation, promoted-character, perception, radio and Memory K systems are on `main`. Some parts still need in-game testing, and experimental features can be off by default. **Merged code isn't the same as a GTA-tested feature.**

Next up: expanded NPC activities (**ACT3–ACT5**), nearby speech and NPC-to-NPC conversations, memory-aware reactions and richer world behavior. A standalone replacement is being developed separately; **this fork still requires Essential**.

See the [roadmap](docs/ROADMAP.md) for the actual status and what's next.

## Requirements

- **GTA V Enhanced**, **RAGE Plugin Hook**, **Damage Tracking Framework** and a matching **Los Santos Alive Essential Hotfix #3** installation.
- **Node.js 20.19+** to build from source and an **OpenAI API key** for the Luna route. ElevenLabs is optional.
- LSPDFR / Policing Redefined dependencies if you're using that game mode.

## Build

```powershell
cd lsa-essential-e1-candidate
npm test
npm run build
```

Builds and tests are offline and **do not install anything into GTA**. Installation needs a matching stock Essential package, a staged build and explicit verification. Follow the [deployment guide](deployment/README.md).

Provider settings start in [`e1.config.example.json`](lsa-essential-e1-candidate/e1.config.example.json); keep API keys in your private `.env`, not in the repository. The unified settings importer is optional and does not rewrite working configs on its own.

## Project links

- [Roadmap — what's built and what's next](docs/ROADMAP.md)
- [Implementation status — code vs. actual GTA evidence](docs/IMPLEMENTATION-STATUS-20261017.md)
- [Next development tasks](docs/NEXT-PHASES-20261017.md)
- [Companion build and configuration](lsa-essential-e1-candidate/README.md)
- [Deployment and rollback](deployment/README.md)

Essential stays in charge of the game. LSA Enhanced builds on what it already does, rather than trying to replace it.
