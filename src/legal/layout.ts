// La coquille commune aux pages legales servies par l'API. Extraite quand les
// conditions d'utilisation ont rejoint la politique de confidentialite : deux
// pages qui divergeraient visuellement se liraient comme deux documents sans
// rapport, et la CSS n'a pas besoin d'exister en deux exemplaires.

export const LEGAL_STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0 auto;padding:32px 20px 72px;background:#0d0d0f;color:#e9e9ec;max-width:44rem;
font:16px/1.6 -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;
-webkit-text-size-adjust:100%}
h1{font-size:1.5rem;letter-spacing:-.02em;margin:0}
h2{font-size:1rem;letter-spacing:-.01em;margin:40px 0 12px;padding-top:20px;border-top:1px solid #23232a}
p,li{color:#c9c9d1}
.lede{color:#e9e9ec}
.sub{color:#8a8a94;font-size:.85rem;margin-top:6px}
a{color:#e9e9ec}
ul{padding-left:1.1rem;margin:12px 0}
li{margin:6px 0}
li b{color:#e9e9ec;font-weight:600}
.note{background:#141419;border:1px solid #23232a;border-radius:10px;padding:14px 16px;margin:16px 0}
.note p{margin:0;color:#c9c9d1;font-size:.92rem}
footer{margin-top:48px;color:#8a8a94;font-size:.85rem}
`

export function legalPage(input: { french: boolean; title: string; body: string }): string {
  return `<!doctype html>
<html lang="${input.french ? 'fr' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${input.title}</title>
<meta name="theme-color" content="#0d0d0f">
<meta name="robots" content="noindex">
<style>${LEGAL_STYLE}</style>
</head>
<body>${input.body}</body>
</html>
`
}

/// Ne lit que la premiere balise, la plus prioritaire, de l'en-tete
/// Accept-Language : tout le reste servirait du francais a un lecteur qui ne
/// fait que le mentionner en repli. Pas d'en-tete du tout signifie anglais.
export function wantsFrench(header: string | null | undefined): boolean {
  const first = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
  return first.startsWith('fr')
}
