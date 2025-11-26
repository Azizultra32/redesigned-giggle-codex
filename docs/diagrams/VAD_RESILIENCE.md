# VAD Resilience Flow (Text Diagram)

The core audio path keeps running even if VAD is unavailable. The VAD/Concierge
logic rides in a sidecar and can be bypassed automatically.

```
[Microphone]
     |
     v
[Browser WS Client] --(raw PCM)--> [Backend Broker] --(PCM)--> [Deepgram]
                                        |                         |
                                        |                         v
                                        |                  [Transcripts]
                                        |                         |
                                        v                         v
                               [Supabase Storage]       [Extension UI]
                                        \
                                         \
                                          >-- (optional) -> [Concierge/VAD Hooks]
                                                            (consent intents, badges)
```

Fallback on VAD glitch:

```
[Connect w/ VAD]
     | (error before open)
     v
[Fallback: reconnect without VAD]
     |
     v
[Stream audio + transcripts normally]
```

Operational notes
- Default behavior uses Deepgram VAD events. Set `DEEPGRAM_ENABLE_VAD=false` to
  skip VAD proactively (useful for fire drills or when experimenting with
  alternate VAD engines).
- If the initial VAD-enabled connection fails, the backend automatically retries
  without VAD so transcripts continue to flow.
- The extension UI remains responsive because recording/websocket piping does
  not wait on VAD hooks.
