import assert from 'node:assert/strict'
import { test } from 'node:test'
import { targetMinutesFor, voiceFor } from './config.js'

// Ces tests exercent les regles des paliers ALLUMEES. En production elles sont
// eteintes tant que FREEMIUM_ENFORCED n'est pas pose (voir freemiumEnforced) ;
// chaque fichier de test tourne dans son propre processus, donc ceci ne fuit pas.
process.env.FREEMIUM_ENFORCED = 'true'

test('le palier plafonne la duree, meme si la base dit plus', () => {
  assert.equal(targetMinutesFor('free', null, 10), 3)
  assert.equal(targetMinutesFor('plus', 5, 5), 3)
  assert.equal(targetMinutesFor('pro', 5, 5), 5)
  assert.equal(targetMinutesFor('pro', null, 10), 5) // MAX_TARGET_MINUTES
  assert.equal(targetMinutesFor('pro', 4, 5), 4)
})

test('une duree absurde est ramenee dans les bornes, jamais rejetee', () => {
  assert.equal(targetMinutesFor('pro', 0, 5), 1)
  assert.equal(targetMinutesFor('pro', -7, 5), 1)
  assert.equal(targetMinutesFor('pro', 99, 5), 5)
})

test('seul le palier pro choisit sa voix', () => {
  const nico = 'MAZdzkb78f8SA7DNBT41'
  const eric = 'cjVigY5qzO86Huf0OWal'
  assert.equal(voiceFor('en', nico, 'pro'), nico)
  // Un voice_id reste en base sur un compte redescendu : il est IGNORE, pas
  // efface, pour que le reabonnement retrouve le choix intact.
  assert.equal(voiceFor('en', nico, 'free'), eric)
  assert.equal(voiceFor('en', nico, 'plus'), eric)
  assert.equal(voiceFor('en', null, 'pro'), eric)
})

test('eteint, le freemium laisse la duree et la voix comme avant la fusion', () => {
  delete process.env.FREEMIUM_ENFORCED
  try {
    assert.equal(targetMinutesFor('free', null, 10), 5) // MAX_TARGET_MINUTES seul
    assert.equal(targetMinutesFor('free', 4, 5), 4)
    assert.equal(voiceFor('fr', 'MAZdzkb78f8SA7DNBT41', 'free'), 'MAZdzkb78f8SA7DNBT41')
  } finally {
    process.env.FREEMIUM_ENFORCED = 'true'
  }
  assert.equal(targetMinutesFor('free', null, 10), 3)
})
