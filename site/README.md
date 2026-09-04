# site — landing podcapp.fr

Statique, sans build. HTML + une feuille de style, police Inter Tight auto-hébergée.
L'anglais est la langue par défaut, servi à la racine ; `/en/` redirige vers `/` en 308.
Le blog existe dans les deux langues, chaque article pointe vers sa traduction.

```
index.html                  landing EN (langue par defaut)
fr/index.html               landing FR
blog/index.html             liste des articles EN
blog/<slug>/index.html      un article EN
fr/blog/                    les memes en francais, slugs francais
assets/site.css             toute la mise en forme
assets/fonts/*.woff2        Inter Tight variable (latin, latin-ext)
```

Aperçu local :

```
npx serve site
```

Déploiement (projet Vercel `podcapp-site`, séparé du projet API `podcapp`) :

```
cd site && vercel --prod
```

Ajouter un article : dupliquer un dossier de `blog/` ET son equivalent `fr/blog/`,
changer le contenu, croiser les `hreflang` (les trois : `en`, `fr`, `x-default`
qui pointe la version anglaise) et la bascule de langue entre les deux, adapter le
bloc `application/ld+json` du `<head>` (`BlogPosting` + `BreadcrumbList` : titre,
description, `datePublished`, `url`), puis ajouter la carte dans les deux
`index.html`, la referencer dans le `blogPost` des deux index, et poser les deux
URL dans `sitemap.xml` avec leur `lastmod`.

## SEO

Chaque page indexable porte : `canonical` absolu, le trio `hreflang`
(`en` / `fr` / `x-default` vers l'anglais), `robots` avec `max-image-preview:large`,
les balises Open Graph, et un `@graph` JSON-LD (`Organization` partout, plus
`WebSite`+`WebPage` sur les landings, `Blog` sur les index, `BlogPosting`+
`BreadcrumbList` sur les articles). Les pages legales restent `noindex`.

`sitemap.xml` liste exactement les 10 URL canoniques, chacune avec son `lastmod`
(date du dernier changement de CONTENU, pas d'une retouche de balisage) et le jeu
complet d'alternates. `robots.txt` le declare.

### Carte sociale (Open Graph)

`assets/og/card-{en,fr}.jpg`, 1200x630, referencees par `og:image`,
`twitter:image` et le JSON-LD de chaque page dans sa langue. Ce ne sont pas des
assets tombes du ciel : `card.html` les dessine avec `site.css` (meme Inter
Tight, memes tokens) et `make-og.sh` les screenshotte en Chrome headless puis
les encode en JPEG q92 (60 Ko contre 310 Ko en PNG, aucune difference visible).

```
sh site/assets/og/make-og.sh
```

Changer la copie dans `card.html` ; les chaines FR sont dans le script en bas du
fichier, une seule mise en page pour les deux langues. Les classes du gabarit
sont prefixees `og-` parce que `site.css` definit deja `.card`, `.foot`, `.row`.
ATTENTION : `/assets/*` est servi en `immutable` un an, donc une carte refaite
sous le meme nom reste en cache chez les clients ; si le visuel change vraiment,
changer aussi le nom du fichier.

Le site repond aussi sur `podcapp-site.vercel.app` : les `canonical` absolus
renvoient tout vers `podcapp.fr`, donc pas de contenu duplique aux yeux de Google.

Google Search Console : propriete de type **Domaine** (couvre l'apex, `www`, http
et https d'un coup), validee par un enregistrement TXT dans la zone OVH, puis
soumettre `sitemap.xml` dans Sitemaps.

La mise en page reprend telle quelle l'artboard Claude Design (`Podcapp Landing FR`) :
couleurs, rayons, ombres et tailles sont identiques au-dessus de 1060 px de large.

## DNS — podcapp.fr (étape manuelle, espace client OVH)

Les domaines `podcapp.fr` et `www.podcapp.fr` sont déjà attachés au projet Vercel
`podcapp-site` (www redirige vers l'apex en 308). Il reste à faire pointer la zone.

OVH → Noms de domaine → podcapp.fr → Zone DNS :

| Type | Sous-domaine | Cible actuelle | Cible à poser |
|---|---|---|---|
| A | (racine, vide) | 213.186.33.5 | **76.76.21.21** |
| A ou CNAME | www | 213.186.33.5 | **CNAME → cname.vercel-dns.com.** |

Ne pas toucher aux MX (`mx1/2/3.mail.ovh.net`) ni à l'enregistrement SPF : l'e-mail
du domaine passe par eux. Vercel émet le certificat seul après propagation.

Contrôle :

```
vercel domains inspect podcapp.fr
```
