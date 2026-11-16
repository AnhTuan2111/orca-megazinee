# Machines

A plugin for [Orca](https://github.com/stablyai/orca) that shows how your Linux servers are doing without SSHing into
each one. The sidebar panel starts with a host list, one compact row per machine with its CPU, RAM and disk; press a
row to open that machine below the list, so twenty hosts are twenty rows, not twenty cards. The open machine has its
name, SSH target and uptime, a Shell button, and three tabs:

- **Overview:** CPU, RAM and disk `/` as block gauges, disk `/` over the last 24 hours, CPU over the last 30
  minutes, load average, network rate, running and failing containers, failed systemd units, uptime.
- **Containers:** every container with an icon for its kind of software (database, queue, proxy, CI, monitoring),
  its state, CPU and RAM, in aligned columns. One column in a narrow sidebar, a grid when the panel is wide. Pick a
  container to open its logs (`docker logs -f --tail 200`) or a shell (`docker exec -it ... sh`) in an Orca terminal.
- **Disk:** a disk map of `/` (Docker, the largest directories, the rest, free space), how much Docker space can be
  freed, each Docker type with in-use and reclaimable space, a directory tree with sizes, and the largest container
  logs.

The status bar shows the machine in the worst shape, for example `web-01 disk ▰▰▰▰▰▰▱▱ 81% · CPU 27%`. It stays
white while every number is fine and turns red as soon as one crosses a threshold. Hover for every machine's summary;
click to toggle the right sidebar.

## Look and feel

The panel borrows the look of Orca's own status bar item, so it reads at a glance and stays out of the way:

- **Block gauges.** CPU, RAM and disk are rows of slanted blocks that fill up like a magazine being loaded: `▰` is a
  loaded cell, `▱` an empty one. Ten cells per gauge, so every cell is 10%. The disk map uses the same blocks in
  several colours, one stretch per part of the disk (Docker, the two largest directories, the rest), with the empty
  cells as free space. Each Docker type gets a two-colour gauge: in use, then reclaimable.
- **Colour means level.** Blue is fine, yellow is from 70%, red is from 90%. The gauge, its number and its label all
  take the colour, so a whole row turns yellow or red when it crosses a threshold. Green marks good news only:
  healthy containers and space that can be freed.
- **Square outlines on black.** Chips, host rows, container tiles and frames are square-cornered outlines in their
  colour, with no fill. Buttons are borderless, so nothing round competes with the blocks.
- **Columns that line up.** Container tiles put the state, CPU and RAM chips in fixed-width columns, and RAM is always
  in GiB, so the chips line up down the list like a table, whether the tiles stack in one column or spread into a
  grid on a wide panel.
- **Charts.** The 24 hour disk and 30 minute CPU charts are outlined columns in the same colours. The disk chart
  zooms into the range it actually moved in, since disk only creeps a few percent a day; a thin stub marks an hour or
  minute without data.
- **Icons say what a container is.** Databases, queues, proxies, CI tools and monitoring each get their own icon,
  picked from the image name.

## How the numbers arrive

When the plugin is enabled, its worker opens one SSH connection to each machine and keeps it. Over that connection
it sends a short `sh` loop that reads `/proc` every 2 seconds (CPU, RAM, load, network) and prints a frame of
numbers. Disk is read every 5 frames; `docker ps` and `systemctl --failed` about every 15 seconds. The worker pushes
each frame to the panel and the status bar as it arrives.

Nothing is installed on the target and no file is written there. The loop lives only as long as the connection:
when the connection closes, the loop exits. A dropped connection (VPN down, laptop asleep) reconnects after 2, 4, 8,
16, then every 30 seconds.

The Containers and Disk tabs run `docker stats` and `du` over a separate connection, only when you open them, because
they take seconds (`du` can take over a minute on a server with many files). `du` runs through `sudo` when the SSH
user has passwordless sudo, so root-only directories are counted. The plugin only reads; it never deletes anything.

The 24 hour disk and 30 minute CPU history is saved in the plugin's own storage, so it survives an Orca restart.
Nothing is measured while Orca is closed, and the charts leave those hours empty.

## Notifications

The plugin shows a desktop notification once per crossing, and again only after it clears, when:

- a machine is offline for 30 seconds, and when it comes back;
- disk `/` or RAM reaches 90%;
- CPU stays at 90% for a minute;
- a container is unhealthy or restarting.

Notifications only run while Orca is open, so they do not replace monitoring on the server such as Prometheus and
Alertmanager. Turn them off in Orca's Settings, under the plugin.

## Install

```sh
orca plugin install AnhTuan2111/orca-machines
```

The plugin runs Node code on your computer to call `ssh`, so Orca asks you to approve it first. It asks for:

- a Node worker, and its own settings and storage;
- desktop notifications;
- reading workspace names, to choose where to open terminals;
- opening terminals, for Shell and Logs.

Shell and Logs open a visible terminal tab through the `orca` CLI (`orca terminal create --focus`), because the
plugin API's own `terminal.create` only starts a background terminal with no tab. When the CLI cannot be found, the
terminal still starts in the background and the panel says so.

## Add machines

Press the gear button on the Machines panel, write one machine per line and press Save:

```text
web-01=ubuntu@10.0.0.1
db-01=deploy@db.example.com
```

The part before `=` is the name on the card; the part after is the SSH target, as you would type `ssh <target>`. The
target can also be a `Host` from `~/.ssh/config`. The plugin runs `ssh` with `BatchMode=yes`, so the machine must
accept your key without a password prompt. Machines behind a VPN need the VPN up; when a machine cannot be reached,
its card turns red with `ssh`'s last error line.

Orca's Settings also have the seconds between samples (default 2), notifications on or off, and the path to `ssh`.

## On Windows

The OpenSSH `ssh.exe` that ships with Windows exits with code 255 right away inside Orca's worker, even `ssh -V`
(Orca 1.4.258). So the worker looks for Git for Windows' `ssh.exe` first, in `C:/Program Files/Git/usr/bin/`, and
only falls back to `ssh` on PATH. Without Git for Windows, point the ssh path setting at another ssh build. The Shell
and Logs terminals run the terminal's own `ssh` and are not affected.

## Develop

Orca loads `.ts` and `.tsx` files directly; there is no build step.

- `src/worker.ts`: SSH connections, status bar, notifications and terminals.
- `src/parse.ts`: the scripts that run on the target and the code that reads their output.
- `src/history.ts`: the 24 hour disk and 30 minute CPU history.
- `src/health.ts`: thresholds and problem texts shared by the panel, status bar and notifications.
- `src/panel.tsx`: the machine cards and their tabs.
- `src/protocol.ts`: the requests and events between panel and worker.
- `src/fixtures.ts`: sample data for tests and previews.

```sh
orca plugin dev watch .     # load the folder into Orca and reload on save
orca plugin test .          # run src/*.test.ts in Node
orca plugin check .         # render every scenario in src/panel.check.ts
npx -p typescript tsc -p .  # type check
```

With Orca 1.4.258 on Windows, `orca plugin test` and `orca plugin check` fail when the plugin folder is on a
different drive from Orca's install, with `cannot import "./orca-runtime.mjs"`. Copy the folder to drive `C:` and run
them there.

After a change, run `orca plugin update <plugin key>` so Orca uses the new version. `orca plugin list` shows the key;
a folder install is `local.machines`.
