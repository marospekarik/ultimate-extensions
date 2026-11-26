Runpod pods in the status line: running pods with $/h and spend so far, Stop and Terminate (confirmed, it deletes the disk), and a phone push when a pod has run an hour with no input to any Ultimate.

Uses Runpod's REST API (`https://api.runpod.io/v2`) with the `RUNPOD_API_KEY` secret (Pods read and write is enough). The chip shows in every project and appears once the account has a pod.

**Alert.** Every minute each Ultimate process records its newest input in `~/.ultimate/runpod-watch.json`. Only the instance whose project is `ALERT_PROJECT` (a constant in `server.ts`, lora-pilot's checkout) pushes through the `push` extension, for each RUNNING pod when the newest input in any project is over an hour old, then again every hour. Push cannot say which instance has a subscription, so turn notifications on (the bell) in the installed app on lora-pilot's address. The push opens the app: tap the chip to Stop.
