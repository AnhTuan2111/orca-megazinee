<img src="docs/hero.svg" width="100%" alt="Megazinee: your servers, live in Orca. A host list with CPU, RAM and disk per machine, block gauges, a 24 hour disk chart, and a red status bar item for the machine at 82% disk">

```sh
orca plugin install AnhTuan2111/orca-megazinee
```

## Three tabs per machine

<img src="docs/tabs.svg" width="100%" alt="Overview with gauges and a disk chart, Containers with state, CPU and RAM chips in aligned columns, Disk with a disk map, space to free and a directory tree">

Notifications when a machine goes offline, disk or RAM passes 80%, CPU stays above 80%, or a container fails.

## Four colours

<img src="docs/colors.svg" width="100%" alt="Green below 50%, blue from 50 to 69%, yellow from 70 to 79%, red from 80%">

## Add a machine

Press the gear on the panel, add a line, press Save. Key login only.

```text
web-01=ubuntu@10.0.0.1
monitor=admin@10.0.0.2:2222
```

On Windows the plugin uses Git for Windows' `ssh.exe`.

## Develop

```sh
orca plugin dev watch .     # load, reload on save
orca plugin test .          # tests
python docs/make_svgs.py    # redraw these images
```
