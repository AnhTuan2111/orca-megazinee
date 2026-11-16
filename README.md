# Machines

Plugin cho [Orca](https://github.com/stablyai/orca): một panel ở sidebar cho xem nhanh các server Linux của bạn đang
thế nào, khỏi phải SSH vào từng máy gõ lệnh xem. Mỗi máy là một thẻ gồm CPU, RAM, disk của `/`, load
avg, số container đang chạy và số container unhealthy, số unit systemd failed, uptime. Badge chuyển vàng khi số
liệu từ 70%, chuyển đỏ khi từ 90%.

Panel lấy số liệu 30 giây một lần, và chỉ lấy khi panel đang hiện trên màn hình. Mỗi lần lấy, worker của plugin SSH
vào từng máy, chạy một đoạn script `sh` ngắn đọc `/proc/stat`, `/proc/meminfo`, `df`, `docker ps`, `systemctl`, rồi
trả kết quả về panel. Trên máy đích không phải cài thêm gì.

## Cài

```sh
orca plugin install AnhTuan2111/orca-machines
```

Plugin chạy code Node trên máy bạn để gọi `ssh`, nên Orca sẽ hỏi bạn phê duyệt trước khi bật nó. Quyền plugin xin
gồm chạy một worker Node và đọc ghi setting của chính plugin.

## Thêm máy

Mở panel Machines, ghi mỗi dòng một máy vào ô nhập rồi bấm Lưu:

```text
web-01=ubuntu@10.0.0.1
db-01=deploy@db.example.com
```

Phần trước dấu `=` là tên hiện trên thẻ, phần sau là đích SSH, viết như khi gõ `ssh <đích>`. Plugin chạy `ssh` với
`BatchMode=yes`, nên máy phải SSH được bằng khoá, không hỏi mật khẩu. Đích SSH cũng có thể là tên một `Host` trong
`~/.ssh/config`. Máy nằm sau VPN thì phải bật VPN trước; khi không kết nối được, thẻ của máy đó báo đỏ kèm dòng lỗi
của `ssh`.

Trong Settings của Orca, mục của plugin này có thêm số giây giữa hai lần lấy số liệu và đường dẫn chương trình `ssh`.

## Trên Windows

`ssh.exe` của OpenSSH đi kèm Windows thoát với mã 255 ngay khi chạy trong worker của Orca, kể cả lệnh `ssh -V`
(thử với Orca 1.4.258). Vì vậy plugin tìm `ssh.exe` của Git for Windows trước, ở `C:/Program Files/Git/usr/bin/`, và
chỉ khi không thấy mới dùng `ssh` trên PATH. Không cài Git for Windows thì điền setting đường dẫn `ssh` trỏ tới một
bản ssh khác.

## Sửa code

Orca nạp thẳng tệp `.ts` và `.tsx`, không có bước build:

- `src/worker.ts`: gọi `ssh` và trả số liệu cho panel.
- `src/parse.ts`: script chạy trên máy đích, và đoạn đọc output của script thành số liệu.
- `src/panel.tsx`: vẽ các thẻ.
- `src/protocol.ts`: khai báo các request giữa panel và worker.

```sh
orca plugin dev watch .     # nạp thư mục vào Orca, lưu tệp là Orca nạp lại
orca plugin test .          # chạy src/*.test.ts trong Node
npx -p typescript tsc -p .  # kiểm tra kiểu
```

Với Orca 1.4.258 trên Windows, `orca plugin test` và `orca plugin check` báo lỗi `cannot import "./orca-runtime.mjs"`
khi thư mục plugin nằm khác ổ đĩa với chỗ cài Orca. Chép thư mục sang ổ `C:` rồi chạy test ở đó thì qua.

Sửa xong thì chạy `orca plugin update <plugin key>` để Orca dùng bản mới. Plugin key xem bằng `orca plugin list`;
cài từ thư mục thì key là `local.machines`.
