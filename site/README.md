# site — landing podcapp.fr

Statique, sans build. HTML + une feuille de style, police Inter Tight auto-hébergée.

```
index.html                  landing FR
en/index.html               landing EN
blog/index.html             liste des articles
blog/<slug>/index.html      un article
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

Ajouter un article : dupliquer un dossier de `blog/`, changer le contenu, puis ajouter
la carte dans `blog/index.html` et l'URL dans `sitemap.xml`.

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
