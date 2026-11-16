# Changelog

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

- The Machines panel: CPU, RAM, disk, load, containers and failed systemd units of SSH servers, every 30 seconds.
