import { describe, it, expect } from 'vitest'
import { clusterByTopicOverlap, TOPIC_OVERLAP_DEFAULTS, type TopicOverlapPageVectors } from './topic-overlap'

// Helper: 2-D unit vectors on the circle so we control cosine exactly.
// cos(angle-between) = dot for unit vectors. angleDeg → [cos, sin].
function unit(angleDeg: number): number[] {
  const r = (angleDeg * Math.PI) / 180
  return [Math.cos(r), Math.sin(r)]
}
function page(url: string, sigDeg: number | null, bodyDeg: number | null, trunc = false): TopicOverlapPageVectors {
  return {
    url,
    sigVec: sigDeg === null ? null : unit(sigDeg),
    bodyVec: bodyDeg === null ? null : unit(bodyDeg),
    bodyPrefixTruncated: trunc,
  }
}

describe('clusterByTopicOverlap', () => {
  it('exposes pinned defaults', () => {
    expect(TOPIC_OVERLAP_DEFAULTS).toEqual({ wSig: 0.6, wBody: 0.4, threshold: 0.78, maxClusters: 50, maxMembers: 50 })
  })

  it('returns null with fewer than 2 clustering candidates', () => {
    // one candidate (both vecs) + one sig-only → clusteredCandidates = 1
    expect(clusterByTopicOverlap([page('a', 0, 0), page('b', 0, null)])).toBeNull()
    expect(clusterByTopicOverlap([])).toBeNull()
  })

  it('counts observedPages (all) vs clusteredCandidates (both-vector only)', () => {
    // a,b are identical candidates → 1 cluster; c is body-only (not a candidate)
    const r = clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 0), page('c', null, 0)])!
    expect(r.observedPages).toBe(3)
    expect(r.clusteredCandidates).toBe(2)
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].urls).toEqual(['a', 'b'])
    expect(r.clusters[0].size).toBe(2)
    expect(r.clusters[0].minEdgeSimilarity).toBeCloseTo(1, 5)
  })

  it('thresholds the weighted 2-component metric (0.6*sig + 0.4*body)', () => {
    // sig identical (cos=1), body 60° apart (cos=0.5): combined = 0.6*1 + 0.4*0.5 = 0.8 ≥ 0.78 → cluster
    expect(clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 60)])!.clusters).toHaveLength(1)
    // body 90° apart (cos=0): combined = 0.6*1 + 0.4*0 = 0.6 < 0.78 → no edge.
    // 2 candidates (≥2) so NOT null — returns the "analyzed, clean" result with zero clusters
    // (null is reserved for <2 candidates; the builder stores this so the UI shows "no overlap",
    // never "not analyzed").
    const clean = clusterByTopicOverlap([page('a', 0, 0), page('b', 0, 90)])!
    expect(clean.clusters).toHaveLength(0)
    expect(clean.clusteredCandidates).toBe(2)
  })

  it('BRIDGE FIXTURE: single-linkage connects A-B-C even when A-C is below threshold', () => {
    // Choose sig=body angles so combined sim is just the cosine of the angle gap.
    // A@0, B@33, C@66 (all sig=body so combined = cos(gap)).
    // cos(33°)=0.838 ≥0.78 (A-B, B-C); cos(66°)=0.407 <0.78 (A-C).
    const r = clusterByTopicOverlap([page('a', 0, 0), page('b', 33, 33), page('c', 66, 66)])!
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].urls).toEqual(['a', 'b', 'c'])
    expect(r.clusters[0].size).toBe(3)
    // minEdgeSimilarity = weakest DIRECT edge (A-B or B-C), NOT the A-C non-edge.
    expect(r.clusters[0].minEdgeSimilarity).toBeCloseTo(Math.cos((33 * Math.PI) / 180), 4)
  })

  it('orders clusters by size desc then smallest-url; sorts member urls asc', () => {
    // cluster1: a,b,c identical @0 ; cluster2: y,z identical @180
    const r = clusterByTopicOverlap([
      page('c', 0, 0), page('a', 0, 0), page('b', 0, 0),
      page('z', 180, 180), page('y', 180, 180),
    ])!
    expect(r.clusters.map((c) => c.urls)).toEqual([['a', 'b', 'c'], ['y', 'z']])
  })

  it('caps members and clusters with explicit honest flags', () => {
    const many = Array.from({ length: 55 }, (_, i) => page(`u${String(i).padStart(2, '0')}`, 0, 0))
    const r = clusterByTopicOverlap(many, { maxMembers: 50 })!
    expect(r.clusters).toHaveLength(1)
    expect(r.clusters[0].size).toBe(55)            // TRUE size preserved
    expect(r.clusters[0].urls).toHaveLength(50)    // members truncated
    expect(r.clusters[0].membersTruncated).toBe(true)
    expect(r.clustersCapped).toBe(false)
  })

  it('echoes inputCapped and counts bodyPrefixTruncatedPages', () => {
    const r = clusterByTopicOverlap([page('a', 0, 0, true), page('b', 0, 0, false)], { inputCapped: true })!
    expect(r.inputCapped).toBe(true)
    expect(r.bodyPrefixTruncatedPages).toBe(1)
  })

  it('sets clustersCapped when more than maxClusters disconnected networks exist', () => {
    // three disconnected 2-page networks at 0°, 90°, 180° (cross-group cos = 0 < 0.78)
    const pages = [
      page('a0', 0, 0), page('b0', 0, 0),
      page('a9', 90, 90), page('b9', 90, 90),
      page('a1', 180, 180), page('b1', 180, 180),
    ]
    const capped = clusterByTopicOverlap(pages, { maxClusters: 2 })!
    expect(capped.clusters).toHaveLength(2)      // only the largest/first 2 retained
    expect(capped.clustersCapped).toBe(true)
    // no false cap when exactly at the limit
    const exact = clusterByTopicOverlap(pages, { maxClusters: 3 })!
    expect(exact.clusters).toHaveLength(3)
    expect(exact.clustersCapped).toBe(false)
  })
})
