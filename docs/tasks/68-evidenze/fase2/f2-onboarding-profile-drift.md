# N33 (chiusa Task 71) — route vs fonte unica buildAdaptiveProfileFromOnboarding

## Caso worker-difficile
| campo | route (DB) | fonte unica | drift |
|---|---|---|---|
| executiveLoad | 4.5 | 4.5 | - |
| familyResponsibilityLoad | 3 | 3 | - |
| domesticBurden | 4 | 4 | - |
| workStudyCentrality | 4 | 4 | - |
| avoidanceProfile | 3 | 3 | - |
| activationDifficulty | 5 | 5 | - |
| optimalSessionLength | 45 | 45 | - |
| preferredDecompositionGranularity | 3 | 3 | - |
| predictedBlockLikelihood | 0.3 | 0.3 | - |
| interruptionVulnerability | 3 | 3 | - |
| bestTimeWindows | ["morning"] | ["morning"] | - |
| worstTimeWindows | ["night","evening"] | ["night","evening"] | - |
| motivationProfile | {"urgency":0.8,"reward":0.5,"relief":0.5,"identity":0.5,"accountability":0.5,"curiosity":0.5} | {"urgency":0.8,"reward":0.5,"relief":0.5,"identity":0.5,"accountability":0.5,"curiosity":0.5} | - |

## Caso parent-gentle
| campo | route (DB) | fonte unica | drift |
|---|---|---|---|
| executiveLoad | 3.5 | 3.5 | - |
| familyResponsibilityLoad | 4 | 4 | - |
| domesticBurden | 3 | 3 | - |
| workStudyCentrality | 2 | 2 | - |
| avoidanceProfile | 2 | 2 | - |
| activationDifficulty | 2 | 2 | - |
| optimalSessionLength | 10 | 10 | - |
| preferredDecompositionGranularity | 3 | 3 | - |
| predictedBlockLikelihood | 0.2 | 0.2 | - |
| interruptionVulnerability | 4 | 4 | - |
| bestTimeWindows | ["evening"] | ["evening"] | - |
| worstTimeWindows | ["morning"] | ["morning"] | - |
| motivationProfile | {"identity":0.8,"urgency":0.5,"relief":0.5,"reward":0.5,"accountability":0.5,"curiosity":0.5} | {"identity":0.8,"urgency":0.5,"relief":0.5,"reward":0.5,"accountability":0.5,"curiosity":0.5} | - |

## Caso student-medio
| campo | route (DB) | fonte unica | drift |
|---|---|---|---|
| executiveLoad | 3 | 3 | - |
| familyResponsibilityLoad | 2 | 2 | - |
| domesticBurden | 2 | 2 | - |
| workStudyCentrality | 3 | 3 | - |
| avoidanceProfile | 2.5 | 2.5 | - |
| activationDifficulty | 3 | 3 | - |
| optimalSessionLength | 25 | 25 | - |
| preferredDecompositionGranularity | 3 | 3 | - |
| predictedBlockLikelihood | 0.25 | 0.25 | - |
| interruptionVulnerability | 3 | 3 | - |
| bestTimeWindows | ["afternoon"] | ["afternoon"] | - |
| worstTimeWindows | ["night"] | ["night"] | - |
| motivationProfile | {"urgency":0.5,"relief":0.5,"identity":0.5,"reward":0.5,"accountability":0.5,"curiosity":0.5} | {"urgency":0.5,"relief":0.5,"identity":0.5,"reward":0.5,"accountability":0.5,"curiosity":0.5} | - |
