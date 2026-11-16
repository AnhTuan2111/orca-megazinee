// `orca plugin check` vẽ panel một lần cho mỗi kịch bản, worker chạy thật trên host mới.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  empty: {}
})
