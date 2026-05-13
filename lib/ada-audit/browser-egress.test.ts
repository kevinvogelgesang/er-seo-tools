import { afterEach, describe, expect, it } from 'vitest'
import {
  getBrowserEgressLaunchArgs,
  hasConfirmedBrowserNetworkIsolation,
  hasBrowserEgressGuardConfig,
  requireBrowserEgressGuardConfig,
} from './browser-egress'

const ORIG_ENV = { ...process.env }

describe('browser egress guard config', () => {
  afterEach(() => {
    process.env = { ...ORIG_ENV }
  })

  it('requires proxy or firewall confirmation in production', () => {
    process.env = { ...ORIG_ENV, NODE_ENV: 'production' }
    delete process.env.CHROME_PROXY_SERVER
    delete process.env.CHROMIUM_NETWORK_ISOLATED

    expect(() => requireBrowserEgressGuardConfig()).toThrow(/egress guard/)
  })

  it('accepts explicit firewall confirmation in production', () => {
    process.env = {
      ...ORIG_ENV,
      NODE_ENV: 'production',
      CHROMIUM_NETWORK_ISOLATED: 'true',
    }
    delete process.env.CHROME_PROXY_SERVER

    expect(hasBrowserEgressGuardConfig()).toBe(true)
    expect(hasConfirmedBrowserNetworkIsolation()).toBe(true)
    expect(() => requireBrowserEgressGuardConfig()).not.toThrow()
  })

  it('adds Chrome proxy launch args when configured', () => {
    process.env = {
      ...ORIG_ENV,
      CHROME_PROXY_SERVER: 'http://127.0.0.1:3128',
      CHROME_PROXY_BYPASS_LIST: '<-loopback>',
    }

    expect(getBrowserEgressLaunchArgs()).toEqual([
      '--proxy-server=http://127.0.0.1:3128',
      '--proxy-bypass-list=<-loopback>',
    ])
  })
})
