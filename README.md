# Extensão: Revisão Lance Certo

Adiciona um botão **"♞ Revisão Lance Certo"** logo acima do botão de revisão nas partidas **terminadas** do chess.com. O botão herda o estilo da página. Ao clicar (ou ao clicar no ícone da extensão), a revisão aparece em **dois painéis encaixados nos elementos do site**: um exatamente sobre o tabuleiro (com a barra de avaliação) e outro sobre a coluna lateral. Eles acompanham rolagem, redimensionamento e o layout de tela estreita, e as barras dos jogadores e o resto do site continuam visíveis:

- classificação de cada lance: **Brilhante, Ótimo, Melhor, Excelente, Bom, Teoria, Forçado, Imprecisão, Erro, Oportunidade perdida e Capivarada**;
- precisão de cada jogador, contagem por categoria e gráfico de avaliação clicável;
- tabuleiro com barra de avaliação, ícone da classificação na casa do lance e seta com o melhor lance;
- explicação de cada lance ("O melhor era…", "Havia mate em 2"), nome da abertura e botão "Próximo erro";
- navegação pelas setas do teclado; **Esc** fecha o painel.

A análise roda **no seu navegador** com o Stockfish 19 Lite (WASM), a mesma versão do painel de análise do chess.com, sem limite de revisões e sem enviar nada a servidores. Se o Stockfish não carregar, a extensão usa automaticamente o motor interno do Lance Certo, que é mais fraco.

## Instalar (Chrome, Edge, Brave ou Opera)

1. Baixe o repositório (**Code → Download ZIP**) e descompacte.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta descompactada (a que contém o `manifest.json`).
4. Abra uma partida terminada no chess.com e clique em **♞ Revisão Lance Certo**.

O ícone da extensão na barra do navegador abre a revisão numa aba, onde você pode colar um PGN ou revisar sua última partida pelo nome de usuário.

## Como a partida é obtida

A extensão lê o número da partida na URL (ou nos links da página) e busca o PGN pela **API pública** do chess.com (`api.chess.com/pub/player/<usuário>/games/...`), usando os nomes dos jogadores mostrados na página ou o usuário salvo nas configurações. Partidas recém-terminadas podem levar alguns minutos para aparecer na API. Nesse caso, cole o PGN (Compartilhar → PGN).

A revisão **só funciona para partidas terminadas**: PGNs sem resultado são recusados, para que a extensão não sirva de ajuda durante uma partida.

## Como os lances são classificados

Para cada posição, o motor calcula a avaliação, o melhor lance e o segundo melhor (MultiPV 2). A avaliação vira **chance de vitória** (0–100%), e a perda de cada lance é a queda nessa chance:

| Perda | Classificação |
| --- | --- |
| lance do motor | Melhor |
| ≤ 2 | Excelente |
| ≤ 5 | Bom |
| ≤ 10 | Imprecisão |
| ≤ 20 | Erro |
| > 20 | Capivarada |

Casos especiais:

- **Brilhante**: um dos melhores lances que entrega material (o adversário pode capturar e ganhar 2 peões ou mais) e mantém a posição boa.
- **Ótimo**: o melhor lance, com o segundo melhor bem pior (praticamente o único lance bom).
- **Oportunidade perdida**: o adversário errou e você não aproveitou.
- **Teoria**: lances que seguem linhas conhecidas de abertura.
- **Forçado**: só havia um lance legal.

As faixas acima são as mesmas que o chess.com publica para o seu modelo de "pontos esperados" (0,02 / 0,05 / 0,10 / 0,20). Como lá, a chance de vitória depende do **rating** de quem jogou: para ratings mais baixos, a mesma vantagem em peões vale menos certeza de vitória. A fórmula exata do chess.com não é pública, então este ajuste é uma aproximação, e a classificação pode diferir em alguns lances. A profundidade padrão do Stockfish é 16, e pode chegar a 22 nas configurações.

A precisão usa a fórmula de "precisão por chance de vitória" popularizada pelo Lichess. A do chess.com (CAPS2) também não é pública.

A revisão abre do lado em que você jogou: a extensão usa a orientação do tabuleiro no site e o nome do jogador da barra de baixo.

## Licenças

Conjuntos de peças (pasta `pieces/`, escolha nas configurações):

| Conjunto | Autor | Licença |
| --- | --- | --- |
| gioco (padrão), staunty, tatiana, dubrovny, maestro, cardinal | sadsnake1 | CC BY-NC-SA 4.0 (uso não comercial) |
| caliente | [avi](https://github.com/avi-0/caliente) | CC BY-NC-SA 4.0 (uso não comercial) |
| merida | Armando Hernandez Marroquin | GPLv2+ |
| cburnett | Colin M.L. Burnett | GPLv2+ |

O conjunto Neo do chess.com não está incluído porque é propriedade do chess.com (veja lichess-org/lila#3411). A opção padrão, **"Tema do chess.com"**, usa no overlay as mesmas imagens de peças e tabuleiro que o seu navegador já carrega do chess.com, lidas da própria página no momento da revisão. Nada disso fica salvo na extensão. Se o tema não puder ser lido, a extensão usa o gioco, o conjunto livre mais próximo do Neo.

Por causa da licença CC BY-NC-SA de alguns conjuntos, esta extensão é distribuída gratuitamente e não pode ser vendida.

O Stockfish (pasta `stockfish/`) é software livre sob a **GPL v3** (veja `stockfish/COPYING.txt`). Versão WASM de [stockfish.js](https://github.com/nmrugg/stockfish.js), pacote npm `stockfish@19.0.1`. Esta extensão não é afiliada ao chess.com.

## Desenvolvimento

`lib/` contém o motor de regras (`chess.js`), o tabuleiro (`board.js`), o motor interno (`engine.js`) e os estilos base. Para rodar os testes (leitura de PGN, aberturas e classificação de lances):

```bash
npm test
```
