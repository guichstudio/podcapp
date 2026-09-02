import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { APPLE_AUDIENCE, GOOGLE_CLIENT_ID } from '../config.js'
import { sha256Hex } from './crypto.js'
import { AuthError, type Provider, type VerifiedIdentity } from './types.js'

// Apple accepte un seul issuer ; Google en a historiquement deux, et refuser
// la forme sans schema ferait echouer des jetons parfaitement valides.
//
// Le contrat de nonce n'est pas le meme cote fournisseur : nous envoyons
// toujours sha256hex(rawNonce) au fournisseur et rawNonce au serveur (voir
// Auth.swift cote app), et c'est le fournisseur qui decide ce qu'il renvoie
// dans le claim `nonce`. Apple echo l'empreinte telle quelle, donc la
// comparaison ci-dessous (sha256hex(rawNonce) === payload.nonce) est directe.
// Google, lui, echo le nonce **brut** envoye au depart, pas son empreinte -
// documente ici, pas applique : la voie Google est dormante (aucun bouton ne
// l'appelle), mais quiconque la reveille devra hacher le nonce autrement pour
// ce fournisseur, sous peine de rejeter systematiquement des jetons valides.
const RULES: Record<Provider, { jwks: string; issuers: string[]; audience: () => string }> = {
  apple: {
    jwks: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audience: () => APPLE_AUDIENCE,
  },
  google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audience: () => GOOGLE_CLIENT_ID,
  },
}

// createRemoteJWKSet garde les cles en cache et suit leur rotation ; une
// instance par fournisseur, creee une fois, pour ne pas retelecharger le JWKS
// a chaque connexion.
const remote = new Map<Provider, JWTVerifyGetKey>()
const remoteKeyFor = (p: Provider): JWTVerifyGetKey => {
  const cached = remote.get(p)
  if (cached) return cached
  const set = createRemoteJWKSet(new URL(RULES[p].jwks))
  remote.set(p, set)
  return set
}

// `email_verified` arrive tantot en booleen, tantot en chaine selon le
// fournisseur et le moment : les deux formes vraies sont acceptees, tout le
// reste vaut faux.
const isTrue = (v: unknown): boolean => v === true || v === 'true'

export function createVerifier(keyFor: (p: Provider) => JWTVerifyGetKey = remoteKeyFor) {
  return async function verify(input: {
    provider: Provider
    token: string
    rawNonce: string
  }): Promise<VerifiedIdentity> {
    const rule = RULES[input.provider]
    const audience = rule.audience()
    if (!audience) throw new AuthError(`no audience configured for ${input.provider}`)

    let payload: Record<string, unknown>
    try {
      // algorithms est explicite en defense en profondeur, pas parce que c'est ce
      // qui arrete `alg: none` ou la confusion d'algorithme ici : avec un
      // resolveur JWKS (createLocalJWKSet / createRemoteJWKSet), jose refuse deja
      // ces deux cas au moment de choisir la cle, puisque le resolveur ne vend
      // que des cles de son propre type. Cette option protege un futur keyFor
      // qui melangerait des types de cles.
      const result = await jwtVerify(input.token, keyFor(input.provider), {
        issuer: rule.issuers,
        audience,
        algorithms: ['RS256'],
      })
      payload = result.payload as Record<string, unknown>
    } catch {
      throw new AuthError('token rejected')
    }

    const expected = await sha256Hex(input.rawNonce)
    if (typeof payload.nonce !== 'string' || payload.nonce !== expected) {
      throw new AuthError('nonce mismatch')
    }

    const subject = payload.sub
    if (typeof subject !== 'string' || subject.length === 0) throw new AuthError('no subject')

    const email = typeof payload.email === 'string' ? payload.email : null
    return {
      provider: input.provider,
      subject,
      email,
      // Une adresse absente ne peut pas etre verifiee, quoi que dise le claim.
      emailVerified: email !== null && isTrue(payload.email_verified),
    }
  }
}

export const verifyIdentityToken = createVerifier()
