# Changelog

## 0.4.0

- One panel: the HUD panel from 0.3.0 is now Megazinee, and the panel built from Orca's own controls is gone, with
  its tests and sample data. Settings, history and cache stay, since they belong to the plugin, not the panel.
- In a narrow sidebar a machine's CPU, RAM and disk drop under its name instead of being cut off.

## 0.3.0

- A second panel, Megazinee FUI, with the same features drawn as a sci-fi HUD: cut-corner frames from augmented-ui
  (BSD-2-Clause, in `vendor/augmented-ui`), glowing slanted gauge cells that charge once when a view opens, aligned
  host numbers, cut chart columns.
- The FUI panel reads container logs in place: follow, search with highlighted matches and an optional regex, level
  filters (error, warn, info, other), wrap, timestamps, 100 to 5000 lines, pause, copy, download, and tooltips on
  every control. The worker streams `docker logs -f` and stops when the view closes.
- Containers and Disk open at once with the last results, kept in the plugin's storage. Containers always measure
  again in the background; Disk keeps a report for an hour, and the worker rescans one machine a minute when its
  report is older, so du rarely runs while you wait. Refresh forces a new scan.
- "Can be freed" counts only images no container uses and build cache. Docker's own reclaimable figure for images
  is wrong with the containerd image store (98% while every image had a container), and volumes no container uses
  can still hold data, so they are listed apart.
- A container's CPU is a share of the whole machine, like the machine's own gauge: docker stats counts one core as
  100%, so kafka on two of sixteen cores showed 193% instead of 12%.

## 0.2.1

- A machine on another SSH port is written as `user@host:port`; the port goes to ssh as `-p`, for Shell too.
- The status bar no longer sticks with many machines: its tooltip stays under Orca's 256 character limit, worst first,
  with "+N more" for the rest.
- When several machines share the worst level, the status bar shows the one with the highest CPU, RAM or disk.

## 0.2.0

- The plugin is now called Megazinee (id `megazinee`, repository `orca-megazinee`), after its gauges that fill
  like a magazine being loaded. Orca sees it as a new plugin: add your machines again.
- Each machine keeps one SSH connection and is sampled every 2 seconds instead of every 30. The `intervalSeconds`
  setting is replaced by `sampleSeconds`.
- Machine cards have three tabs: Overview, Containers and Disk.
- Overview: block gauges for CPU, RAM and disk, a 24 hour disk chart and a 30 minute CPU chart, network rate and
  restarting containers. The history is kept in the plugin's storage.
- Containers: every container with an icon, state, CPU and RAM in aligned columns, a grid when the panel is wide, and
  Logs and Shell buttons that open Orca terminals.
- Disk: a disk map, reclaimable Docker space, Docker types, a directory tree and the largest container logs.
- A status bar item with a block gauge for the machine in the worst shape.
- Four colours from calm to urgent: green below 50%, blue from 50%, yellow from 70%, red from 80%.
- Desktop notifications for offline machines, disk or RAM from 80%, CPU at 80% for a minute, and unhealthy or
  restarting containers.
- A host list on top with the selected machine's details below it, so many hosts stay short.
- Shell opens an SSH terminal to the machine.
- Everything is in English, and the README shows the panel, the three tabs and the colours as drawn images.
- Needs Orca 1.4.248 or later, and adds the storage, notification, workspace read and terminal permissions.

## 0.1.0

- The first panel, then called Machines: CPU, RAM, disk, load, containers and failed systemd units of SSH servers,
  every 30 seconds.
