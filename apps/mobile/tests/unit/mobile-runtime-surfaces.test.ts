import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('mobile runtime and interruption surfaces', () => {
  it('exposes a recovery deep-link route and a platform-neutral auth entry', () => {
    const login = readFileSync(resolve(__dirname, '../../app/(auth)/login.tsx'), 'utf8')
    const recovery = readFileSync(resolve(__dirname, '../../app/(auth)/recovery.tsx'), 'utf8')

    expect(login).toContain("'/(auth)/recovery'")
    expect(recovery).toMatch(/requestRecovery|completeRecovery/)
    expect(recovery).toMatch(/accessibilityRole=["']button/)
  })

  it('subscribes POS to native connectivity and foreground events without weakening queue boundaries', () => {
    const pos = readFileSync(resolve(__dirname, '../../app/(app)/pos.tsx'), 'utf8')

    expect(pos).toMatch(/@react-native-community\/netinfo/)
    expect(pos).toMatch(/AppState/)
    expect(pos).toMatch(/createMobileLifecycleController/)
    expect(pos).toMatch(/pendingOperations\(\)/)
    expect(pos).toMatch(/queryOperationStatus\(/)
    expect(pos).toMatch(/onRefresh/)
  })
})
