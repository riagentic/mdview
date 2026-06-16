# Rules

## Debugging UI issues
- ALWAYS instrument with console.log first before forming theories. 30 seconds of logging beats 30 minutes of speculation.
- Before blaming the framework/platform, prove your own code is healthy — check render frequency, signal updates, DOM stability.
- When "nothing happens" on click/interaction, add a console.log immediately and ask user for output.

## AIR signal safety
- Any callback that calls `.set()` inside rAF or effect is a render loop candidate. Treat like `setState` in React's render body — red flag.
- When updating signal state, check if the value actually changed before calling `.set()` to avoid unnecessary re-renders.
