import { describe, it, expect } from 'vitest'
import { classifyCoverage } from './classify'
import type { PairObservation } from './classify'

describe('classifyCoverage', () => {
  describe('state classification', () => {
    it('null current -> failed', () => {
      const result = classifyCoverage(null, false)
      expect(result.state).toBe('failed')
    })

    it('null current with baseline -> failed (baseline is independent)', () => {
      const result = classifyCoverage(null, true)
      expect(result.state).toBe('failed')
    })

    it('runPresent=false -> failed', () => {
      const current: PairObservation = {
        runPresent: false,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('failed')
    })

    it('discoveryCapped=true -> partial', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: true,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('partial')
    })

    it('runStatus="partial" -> partial', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'partial',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('partial')
    })

    it('attributionComplete=false -> partial', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: false,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('partial')
    })

    it('attributionComplete=null (legacy) -> partial', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: null as any, // legacy null case
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('partial')
    })

    it('runPresent && !baselineAvailable && healthy -> first-baseline', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('first-baseline')
    })

    // Verifier-memory-loop fix (Task 4) pinning test: `loadSeoTool` computes
    // `attributionComplete = findings.every(f => f.affectedComplete === true)`,
    // which is VACUOUSLY true for zero findings (the "clean scan" case). An
    // exhausted verifier's terminal placeholder run has runStatus:'partial'
    // AND zero findings — attributionComplete alone would read as complete,
    // but runStatus:'partial' still forces the pair to 'partial', never
    // 'first-baseline'/'comparable'. No code change needed here (the
    // precedence already covers it); this documents WHY the combination is
    // safe so a future precedence reorder can't regress it silently.
    it('exhausted-placeholder pair (runStatus partial, vacuously-complete attribution from zero findings) stays partial', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'partial',
        discoveryCapped: false,
        attributionComplete: true, // vacuous truth: [].every(...) === true
      }
      const result = classifyCoverage(current, true)
      expect(result.state).toBe('partial')
    })

    it('runPresent && baselineAvailable && healthy -> comparable', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, true)
      expect(result.state).toBe('comparable')
    })
  })

  describe('precedence (failed > partial > first-baseline > comparable)', () => {
    it('failed takes precedence over partial', () => {
      // This is implicitly covered by the state tests
      // but explicitly: null current always fails regardless of baseline
      const result = classifyCoverage(null, false)
      expect(result.state).toBe('failed')
    })

    it('partial takes precedence over first-baseline', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: true,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('partial')
      expect(result.baselineAvailable).toBe(false)
    })

    it('first-baseline takes precedence over comparable', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('first-baseline')
    })
  })

  describe('baselineAvailable passthrough', () => {
    it('baselineAvailable=false carries through on failed state', () => {
      const result = classifyCoverage(null, false)
      expect(result.baselineAvailable).toBe(false)
    })

    it('baselineAvailable=true carries through on failed state', () => {
      const result = classifyCoverage(null, true)
      expect(result.baselineAvailable).toBe(true)
    })

    it('baselineAvailable=false carries through on partial state', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'partial',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.baselineAvailable).toBe(false)
    })

    it('baselineAvailable=true carries through on partial state', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'partial',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, true)
      expect(result.baselineAvailable).toBe(true)
    })

    it('baselineAvailable=false carries through on first-baseline state', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.baselineAvailable).toBe(false)
      expect(result.state).toBe('first-baseline')
    })

    it('baselineAvailable=true carries through on first-baseline state', () => {
      // A partial pair with baseline should stay partial, not become comparable
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, true)
      expect(result.baselineAvailable).toBe(true)
      expect(result.state).toBe('comparable')
    })

    it('baselineAvailable=false carries through on comparable state', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.baselineAvailable).toBe(false)
      // This should be first-baseline, not comparable
      expect(result.state).toBe('first-baseline')
    })

    it('baselineAvailable=true carries through on comparable state', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, true)
      expect(result.baselineAvailable).toBe(true)
      expect(result.state).toBe('comparable')
    })
  })

  describe('edge cases', () => {
    it('partial with baseline available stays partial, not comparable', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'partial',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, true)
      expect(result.state).toBe('partial')
      expect(result.baselineAvailable).toBe(true)
    })

    it('healthy current without baseline is first-baseline', () => {
      const current: PairObservation = {
        runPresent: true,
        runStatus: 'complete',
        discoveryCapped: false,
        attributionComplete: true,
      }
      const result = classifyCoverage(current, false)
      expect(result.state).toBe('first-baseline')
    })
  })
})
