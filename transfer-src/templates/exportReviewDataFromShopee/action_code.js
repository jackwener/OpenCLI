async function template_action_code() {
  const SHOPDORA_NOT_LOGGED_IN_MESSAGE = 'Shopdora 未登录'
  const exportReviewButtonSelector =
    'div > div:nth-of-type(1) > div:nth-of-type(2) > div > div.common-btn.en_common-btn'
  const detailFilterLabelSelector =
    'div > div:nth-of-type(4) > div:nth-of-type(2) > label > span.t-checkbox__input:nth-of-type(1)'
  const detailFilterInputSelector =
    'div > div:nth-of-type(4) > div:nth-of-type(2) > label > input.t-checkbox__former'
  const timePeriodStartInputSelector =
    '.review .t-range-input__inner .t-range-input__inner-left .t-input__inner'
  const confirmExportButtonSelector = '.review .button button:last-of-type'

  const randomBetween = (min, max) =>
    Math.floor(Math.random() * (max - min + 1)) + min

  const humanPause = async (min, max = min) => {
    await waitForTimeout(randomBetween(min, max))
  }

  const appendShopdoraLoginMessage = (message, loginMessage) => {
    const base = String(message || '').trim()
    const extra = String(loginMessage || '').trim()
    if (!extra) return base
    return base ? `${base} ${extra}。` : extra
  }

  const readShopdoraLoginState = async () =>
    (await evaluate(() => ({
      hasShopdoraLoginPage: Boolean(document.querySelector('.shopdoraLoginPage')),
      hasPageDetailLoginTitle: Boolean(document.querySelector('.pageDetailLoginTitle')),
    }))) || {
      hasShopdoraLoginPage: false,
      hasPageDetailLoginTitle: false,
    }

  const waitForExportReviewReady = async ({
    timeout = 30000,
    pollInterval = 1000,
  } = {}) => {
    await waitForTimeout(2000)

    const startedAt = Date.now()
    let lastKnownText = ''

    while (Date.now() - startedAt < timeout) {
      const buttonState = await evaluate(() => {
        const selector = '.putButton .common-btn.en_common-btn'
        const loginSelector = '.shopdoraLoginPage'
        const normalizeText = (value) =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
        const targets = Array.from(document.querySelectorAll(selector))
        const target =
          targets.find((element) => {
            const directText = Array.from(element.childNodes)
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent || '')
              .join(' ')
            return normalizeText(directText).includes('Export Review')
          }) || targets[0] || null

        if (document.querySelector(loginSelector)) {
          return {
            found: false,
            text: '',
            done: false,
            reason: 'shopdora_login_required',
          }
        }

        if (!target) {
          return {
            found: false,
            text: '',
            done: false,
          }
        }

        const buttonLabel = normalizeText(
          Array.from(target.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || '')
            .join(' '),
        )

        return {
          found: true,
          text: buttonLabel,
          done: buttonLabel === 'Export Review',
        }
      })

      if (buttonState?.reason === 'shopdora_login_required') {
        throw new Error(
          `Shopee product-shopdora-download requires Shopdora login: ${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`,
        )
      }

      if (buttonState?.done) {
        return
      }

      if (buttonState?.found) {
        lastKnownText = buttonState.text || ''
      }

      await waitForTimeout(pollInterval)
    }

    throw new Error(
      `Timed out waiting for Export Review button text to reset. Last text: ${lastKnownText || 'unknown'}`,
    )
  }

  const settleBeforeAction = async (selector) => {
    await waitForSelector(selector, { state: 'visible', timeout: 10000 })
    await humanPause(300, 900)

    try {
      await hover(selector)
      await humanPause(180, 420)
    } catch (error) {
      // 悬停失败时继续执行，避免单个步骤阻塞整个导出流程。
    }
  }

  const humanClick = async (
    selector,
    { beforeMin = 300, beforeMax = 900, afterMin = 800, afterMax = 1800 } = {},
  ) => {
    await waitForSelector(selector, { state: 'visible', timeout: 10000 })
    await humanPause(beforeMin, beforeMax)
    await settleBeforeAction(selector)
    await click(selector)
    await humanPause(afterMin, afterMax)
  }

  const humanCheck = async (
    selector,
    { beforeMin = 250, beforeMax = 700, afterMin = 700, afterMax = 1500 } = {},
  ) => {
    await waitForSelector(selector, { state: 'attached', timeout: 10000 })
    await humanPause(beforeMin, beforeMax)
    await check(selector)
    await humanPause(afterMin, afterMax)
  }

  const computeShiftedDateFromInputValue = (
    value,
    monthOffset = -3,
    dayOffset = 7,
  ) => {
    const normalized = String(value || '').trim()
    const match = normalized.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D.*)?$/)
    if (!match) {
      throw new Error(
        `Shopee product-shopdora-download could not parse the time-period start date: ${normalized || '(empty)'}`,
      )
    }

    const year = Number.parseInt(match[1], 10)
    const monthIndex = Number.parseInt(match[2], 10) - 1
    const day = Number.parseInt(match[3], 10)
    const target = new Date(Date.UTC(year, monthIndex, day))
    if (
      Number.isNaN(target.getTime())
      || target.getUTCFullYear() !== year
      || target.getUTCMonth() !== monthIndex
      || target.getUTCDate() !== day
    ) {
      throw new Error(
        `Shopee product-shopdora-download could not parse the time-period start date: ${normalized}`,
      )
    }

    const originalDay = target.getUTCDate()
    target.setUTCDate(1)
    target.setUTCMonth(target.getUTCMonth() + monthOffset)
    const daysInMonth = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate()
    target.setUTCDate(Math.min(originalDay, daysInMonth))
    target.setUTCDate(target.getUTCDate() + dayOffset)

    const yyyy = target.getUTCFullYear()
    const mm = String(target.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(target.getUTCDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const setTimePeriodStartRelative = async () => {
    const result = await evaluate(`
      (() => {
        const input = document.querySelector(${JSON.stringify('.review .t-range-input__inner .t-range-input__inner-left .t-input__inner')})
        if (!(input instanceof HTMLInputElement)) {
          return { ok: false, error: 'date_input_not_found' }
        }

        input.click()
        input.focus()
        return { ok: true, value: input.value }
      })()
    `)

    if (!result?.ok) {
      throw new Error('Shopee product-shopdora-download could not read the time-period start date')
    }

    const value = computeShiftedDateFromInputValue(String(result.value || '').trim())
    await type(timePeriodStartInputSelector, value)
    await press('Enter')
    return value
  }

  const shopdoraLoginState = await readShopdoraLoginState()
  const shopdoraLoginMessage =
    shopdoraLoginState?.hasShopdoraLoginPage || shopdoraLoginState?.hasPageDetailLoginTitle
      ? SHOPDORA_NOT_LOGGED_IN_MESSAGE
      : ''

  await humanPause(900, 1800)
  await humanClick(exportReviewButtonSelector, {
    afterMin: 1200,
    afterMax: 2400,
  })
  const postExportShopdoraLoginState = await readShopdoraLoginState()
  if (postExportShopdoraLoginState?.hasShopdoraLoginPage) {
    return [
      {
        action: 'shopdora_login_required',
        status: 'not_logged_in',
        success: false,
        timestamp: new Date().toISOString(),
        message: `${SHOPDORA_NOT_LOGGED_IN_MESSAGE}，请先登录 Shopdora 后重试。`,
        product_url: window.location.href,
        selected_start_date: '',
        shopdora_login_message: SHOPDORA_NOT_LOGGED_IN_MESSAGE,
      },
    ]
  }
  await waitForSelector(timePeriodStartInputSelector, {
    state: 'visible',
    timeout: 10000,
  })
  await settleBeforeAction(timePeriodStartInputSelector)
  const selectedStartDate = await setTimePeriodStartRelative()
  await humanPause(1000, 2500)
  await humanClick(detailFilterLabelSelector)
  await humanCheck(detailFilterInputSelector)
  await humanClick(confirmExportButtonSelector, {
    afterMin: 800,
    afterMax: 1500,
  })
  await waitForExportReviewReady()

  return [
    {
      action: 'download_completed',
      status: 'success',
      success: true,
      timestamp: new Date().toISOString(),
      message: appendShopdoraLoginMessage(
        'Downloaded Shopee product Shopdora export with the recorded good-detail filter.',
        shopdoraLoginMessage,
      ),
      product_url: window.location.href,
      selected_start_date: selectedStartDate,
      shopdora_login_message: shopdoraLoginMessage,
    },
  ]
}

export default template_action_code;
