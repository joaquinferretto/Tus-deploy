import type { Browser, BrowserContext, Page } from 'playwright-core'
import { normalizarDni, soloDigitos, type PersonaFuenteExterna } from './modelo.ts'
import {
  ErrorProveedorIdentidad,
  type IdentityVerificationProvider,
  type ResultadoProveedorIdentidad,
} from './proveedor.ts'
import type { BrowserSessionStore } from './puertos.ts'

// Temporary adapter until the Nosis API is contracted: automates the operator's own Mi Nosis
// account with Chromium. Only the DNI search of the "Localizador" is used and only document
// number, name and CUIL are read. Never searches by phone or activity, never stores pages.

// ---- selectors (single place to adjust when Mi Nosis changes its layout) ------------------

export interface SelectoresMiNosis {
  loginDocumento: string
  loginClave: string
  // Mi Nosis' own checkbox on the login form (a native <input type=checkbox>).
  loginCheckbox: string
  loginSubmit: string
  // Visible only when the session is authenticated.
  sesionActiva: string
  localizadorTipoDocumento: string
  localizadorInput: string
  localizadorSubmit: string
  resultadosTabla: string
  sinResultados: string
}

export const SELECTORES_MI_NOSIS: SelectoresMiNosis = {
  loginDocumento: 'input[name="documento" i], input[id="documento" i], input[name="usuario" i]',
  loginClave: 'input[type="password"]',
  loginCheckbox: 'form input[type="checkbox"]:not([disabled])',
  loginSubmit: 'form button[type="submit"], form input[type="submit"]',
  sesionActiva:
    'a[href*="logout" i], a[href*="cerrarsesion" i], a[href*="salir" i], [data-nosis-session]',
  localizadorTipoDocumento: 'select[name*="tipo" i]',
  localizadorInput: 'input[name*="documento" i], input[name*="busqueda" i], input[type="search"]',
  localizadorSubmit: 'button[type="submit"], input[type="submit"]',
  resultadosTabla: 'table',
  sinResultados: 'text=/no se encontraron|sin resultados|no hay resultados/i',
}

// Third-party anti-bot challenges. They are NEVER clicked or solved automatically: the worker
// stops (session_required) and a human completes them in the headful login runner.
const DESAFIOS_EXTERNOS = [
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[src*="challenges.cloudflare.com" i]',
  'iframe[src*="turnstile" i]',
  'iframe[title*="captcha" i]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '[data-sitekey]',
]

export interface ConfiguracionNosisBrowser {
  loginUrl: string
  localizadorUrl: string
  documento?: string
  clave?: string
  headless: boolean
  // When false, an expired session always waits for the human login runner.
  autoLogin: boolean
  timeoutMs?: number
  executablePath?: string
  selectors?: Partial<SelectoresMiNosis>
}

export type WidgetVerificacion = 'none' | 'native_checkbox' | 'external_challenge'

// Page object: every interaction with Mi Nosis goes through here.
export class MiNosisPage {
  readonly selectors: SelectoresMiNosis

  constructor(
    readonly page: Page,
    private readonly config: ConfiguracionNosisBrowser
  ) {
    this.selectors = { ...SELECTORES_MI_NOSIS, ...config.selectors }
  }

  private get timeout() {
    return this.config.timeoutMs ?? 20_000
  }

  async detectVerificationWidget(): Promise<WidgetVerificacion> {
    if (await this.hayDesafioExterno()) return 'external_challenge'
    const checkbox = this.page.locator(this.selectors.loginCheckbox).first()
    if ((await checkbox.count()) > 0 && (await checkbox.isVisible())) return 'native_checkbox'
    return 'none'
  }

  async detectSessionProblem(): Promise<'none' | 'login_required' | 'external_challenge'> {
    if (await this.hayDesafioExterno()) return 'external_challenge'
    if (await this.visible(this.selectors.sesionActiva)) return 'none'
    if (await this.visible(this.selectors.loginClave)) return 'login_required'
    return 'none'
  }

  // `allowLogin=false` only checks the session (worker without auto-login).
  async ensureAuthenticated(allowLogin: boolean): Promise<void> {
    await this.goto(this.config.localizadorUrl)
    const problem = await this.detectSessionProblem()
    if (problem === 'external_challenge') throw desafio()
    if (problem === 'none' && (await this.visible(this.selectors.sesionActiva))) return
    if (!allowLogin || !this.config.documento || !this.config.clave)
      throw new ErrorProveedorIdentidad(
        'NOSIS_SESSION_REQUIRED',
        'Mi Nosis session is not authenticated'
      )
    await this.login()
  }

  async login(): Promise<void> {
    if (!(await this.visible(this.selectors.loginClave))) await this.goto(this.config.loginUrl)
    if (await this.hayDesafioExterno()) throw desafio()
    const documento = this.page.locator(this.selectors.loginDocumento).first()
    const clave = this.page.locator(this.selectors.loginClave).first()
    if ((await documento.count()) === 0 || (await clave.count()) === 0)
      throw layout('login form not found')
    await documento.fill(this.config.documento ?? '')
    await clave.fill(this.config.clave ?? '')
    // Only Mi Nosis' own native checkbox is ticked, and only when no external challenge exists.
    const widget = await this.detectVerificationWidget()
    if (widget === 'external_challenge') throw desafio()
    if (widget === 'native_checkbox') {
      const checkbox = this.page.locator(this.selectors.loginCheckbox).first()
      if (!(await checkbox.isChecked())) await checkbox.check()
    }
    await this.page.locator(this.selectors.loginSubmit).first().click()
    await this.page.waitForLoadState('domcontentloaded')
    try {
      await this.page
        .locator(this.selectors.sesionActiva)
        .first()
        .waitFor({ state: 'visible', timeout: this.timeout })
    } catch {
      if (await this.hayDesafioExterno()) throw desafio()
      throw new ErrorProveedorIdentidad('NOSIS_SESSION_REQUIRED', 'Mi Nosis login did not complete')
    }
  }

  async openLocalizador(): Promise<void> {
    // Always a fresh load: a stale page could hide an expired session until after the search
    // (and its rate-limit slot) was spent.
    await this.goto(this.config.localizadorUrl)
    const problem = await this.detectSessionProblem()
    if (problem === 'external_challenge') throw desafio()
    if (problem === 'login_required')
      throw new ErrorProveedorIdentidad('NOSIS_SESSION_REQUIRED', 'Mi Nosis session expired')
    if (!(await this.visible(this.selectors.localizadorInput)))
      throw layout('localizador search input not found')
  }

  async clearSearch(): Promise<void> {
    const input = this.page.locator(this.selectors.localizadorInput).first()
    if ((await input.count()) > 0) await input.fill('')
  }

  // Types the DNI; `submit` is called (after the rate-limit slot) to send the search.
  async searchByDocument(
    documentNumber: string,
    beforeSubmit: () => Promise<boolean>
  ): Promise<void> {
    const tipo = this.page.locator(this.selectors.localizadorTipoDocumento).first()
    if ((await tipo.count()) > 0) {
      const value = await tipo.evaluate((element) => {
        const select = element as unknown as { options: ArrayLike<{ value: string; text: string }> }
        const option = Array.from(select.options).find((item) =>
          /documento|dni/iu.test(`${item.value} ${item.text}`)
        )
        return option ? option.value : null
      })
      if (!value) throw layout('document search type not available')
      await tipo.selectOption(value)
    }
    await this.clearSearch()
    await this.page.locator(this.selectors.localizadorInput).first().fill(documentNumber)
    if (!(await beforeSubmit()))
      throw new ErrorProveedorIdentidad('NOSIS_RATE_LIMITED', 'rate limit reached')
    await this.page.locator(this.selectors.localizadorSubmit).first().click()
  }

  // Reads ONLY document number, name and CUIL of each result row.
  async readResult(): Promise<PersonaFuenteExterna[]> {
    const table = this.page.locator(this.selectors.resultadosTabla).first()
    const empty = this.page.locator(this.selectors.sinResultados).first()
    try {
      await Promise.race([
        table.waitFor({ state: 'visible', timeout: this.timeout }),
        empty.waitFor({ state: 'visible', timeout: this.timeout }),
      ])
    } catch {
      const problem = await this.detectSessionProblem()
      if (problem === 'external_challenge') throw desafio(true)
      if (problem === 'login_required')
        throw new ErrorProveedorIdentidad(
          'NOSIS_SESSION_REQUIRED',
          'Mi Nosis session expired',
          true
        )
      throw layout('search result did not render', true)
    }
    if (await empty.isVisible().catch(() => false)) return []
    const rows = await table.evaluate((element) => {
      const tableEl = element as unknown as {
        querySelectorAll(
          selector: string
        ): ArrayLike<{
          textContent: string | null
          querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }>
        }>
      }
      const headers = Array.from(tableEl.querySelectorAll('thead th, tr:first-child th')).map(
        (cell) => (cell.textContent ?? '').trim()
      )
      const body = Array.from(tableEl.querySelectorAll('tbody tr')).map((row) =>
        Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').trim())
      )
      return { headers, body: body.filter((cells) => cells.length > 0) }
    })
    const index = (pattern: RegExp) => rows.headers.findIndex((header) => pattern.test(header))
    const docIndex = index(/documento|dni/iu)
    const nameIndex = index(/denominaci|apellido|nombre/iu)
    const cuilIndex = index(/cui[lt]/iu)
    if (docIndex < 0 || nameIndex < 0 || cuilIndex < 0)
      throw layout('result columns not recognized', true)
    return rows.body.map((cells) => ({
      documentNumber:
        normalizarDni(cells[docIndex] ?? null) ?? (soloDigitos(cells[docIndex]) || null),
      fullName: (cells[nameIndex] ?? '').trim() || null,
      cuil: soloDigitos(cells[cuilIndex]) || null,
    }))
  }

  private async hayDesafioExterno(): Promise<boolean> {
    for (const frame of this.page.frames()) {
      if (/recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile/iu.test(frame.url()))
        return true
    }
    return this.page
      .locator(DESAFIOS_EXTERNOS.join(', '))
      .first()
      .count()
      .then((count) => count > 0)
  }

  private async visible(selector: string): Promise<boolean> {
    const locator = this.page.locator(selector).first()
    return (await locator.count()) > 0 && (await locator.isVisible().catch(() => false))
  }

  private async goto(url: string) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeout })
    } catch {
      throw new ErrorProveedorIdentidad('NOSIS_NETWORK', 'Mi Nosis could not be reached')
    }
  }
}

function desafio(searchSubmitted = false) {
  return new ErrorProveedorIdentidad(
    'NOSIS_CHALLENGE_REQUIRED',
    'external verification challenge requires a human',
    searchSubmitted
  )
}

function layout(message: string, searchSubmitted = false) {
  return new ErrorProveedorIdentidad('NOSIS_LAYOUT_CHANGED', message, searchSubmitted)
}

export type LanzadorChromium = (options: {
  headless: boolean
  executablePath?: string
}) => Promise<Browser>

export const lanzarChromium: LanzadorChromium = async (options) => {
  const { chromium } = await import('playwright-core')
  return chromium.launch({
    headless: options.headless,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  })
}

// One browser and one page reused across searches (concurrency 1). The Playwright storage state
// (cookies) is persisted only encrypted through BrowserSessionStore.
export class NosisBrowserIdentityProvider implements IdentityVerificationProvider {
  readonly id = 'nosis-browser' as const
  readonly method = 'nosis_browser' as const
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private nosis: MiNosisPage | null = null

  constructor(
    private readonly config: ConfiguracionNosisBrowser,
    private readonly sessions: BrowserSessionStore,
    private readonly launch: LanzadorChromium = lanzarChromium
  ) {}

  async prepararSesion(): Promise<void> {
    const nosis = await this.pagina()
    await nosis.ensureAuthenticated(this.config.autoLogin)
    await this.persistirSesion()
  }

  async consultar(
    query: { documentNumber: string },
    consumirSlot: () => Promise<boolean>
  ): Promise<ResultadoProveedorIdentidad> {
    const nosis = await this.pagina()
    let submitted = false
    try {
      await nosis.openLocalizador()
      await nosis.searchByDocument(query.documentNumber, async () => {
        const granted = await consumirSlot()
        submitted = granted
        return granted
      })
      const results = await nosis.readResult()
      await nosis.clearSearch().catch(() => undefined)
      await this.persistirSesion()
      return { results, providerReference: null }
    } catch (error) {
      if (error instanceof ErrorProveedorIdentidad)
        throw submitted && !error.searchSubmitted
          ? new ErrorProveedorIdentidad(error.code, error.message, true)
          : error
      // Unknown Playwright failure: treat as a layout problem, never leak page content.
      throw new ErrorProveedorIdentidad(
        'NOSIS_LAYOUT_CHANGED',
        'unexpected browser failure',
        submitted
      )
    }
  }

  // Headful human login (pnpm tus:identity:nosis-login): the operator solves any external
  // challenge by hand; afterwards the encrypted storage state is saved.
  async loginInteractivo(options: { waitMs: number }): Promise<void> {
    const nosis = await this.pagina()
    await nosis.page.goto(this.config.loginUrl, { waitUntil: 'domcontentloaded' })
    if (
      this.config.documento &&
      this.config.clave &&
      (await nosis.detectVerificationWidget()) !== 'external_challenge'
    ) {
      await nosis.login().catch(() => undefined)
    }
    await nosis.page
      .locator(nosis.selectors.sesionActiva)
      .first()
      .waitFor({ state: 'visible', timeout: options.waitMs })
    await this.persistirSesion()
  }

  async cerrar(): Promise<void> {
    await this.context?.close().catch(() => undefined)
    await this.browser?.close().catch(() => undefined)
    this.browser = null
    this.context = null
    this.nosis = null
  }

  private async pagina(): Promise<MiNosisPage> {
    if (this.nosis && !this.nosis.page.isClosed()) return this.nosis
    this.browser ??= await this.launch({
      headless: this.config.headless,
      executablePath: this.config.executablePath,
    })
    const stored = await this.sessions.leer(this.id)
    this.context = await this.browser.newContext({
      ...(stored ? { storageState: JSON.parse(stored) } : {}),
      locale: 'es-AR',
    })
    this.nosis = new MiNosisPage(await this.context.newPage(), this.config)
    return this.nosis
  }

  private async persistirSesion() {
    if (!this.context) return
    await this.sessions.guardar(this.id, JSON.stringify(await this.context.storageState()))
  }
}
