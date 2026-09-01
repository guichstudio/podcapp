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
