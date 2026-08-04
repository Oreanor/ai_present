# Presenter — legendas ao vivo

Diapositivos com legendas traduzidas ao vivo, partilhados diretamente numa
reunião do Teams. Sem Teams Premium, sem bot na reunião, sem nada para a
audiência instalar.

Feito para uma sala que não partilha um único idioma. Os requisitos escritos
estão em [`docs/TZ_presenter_live_captions.md`](docs/TZ_presenter_live_captions.md)
e a apresentação sobre como isto foi construído está em
[`docs/talk/`](docs/talk/) — em inglês, português e russo.

> Versão em inglês: [README.md](README.md).

---

## A ideia numa imagem

Uma janela, partilhada por inteiro:

| Zona | Contém |
|---|---|
| **Palco**, à esquerda | o diapositivo, anotações desenhadas ao vivo, botão de ecrã inteiro |
| **Coluna**, à direita | iniciar/parar, os dois canais, idioma de leitura, a conversa |
| **Faixa**, em baixo | a legenda atual, grande e centrada |

Havia uma segunda janela, privada: o registo era meu, a sala via apenas o
diapositivo. Depois veio a pergunta óbvia — *para quem é o registo?* É para as
pessoas que precisam de ler o que acabou de ser dito. A janela privada ficou
sem nada para guardar, foi apagada, e agora está tudo numa única imagem
partilhada.

Nada no ecrã é secreto, por isso partilhe a janela ou o ecrã, o que for mais
fácil no Teams.

## Duas formas de o executar

**Localmente, sem instalação** — a forma pensada para quem não é programador:

```bash
npm install
npm run build:static
```

Abra `out/control.html` no Chrome. Entregue a pasta `out` a um colega e ele faz
duplo clique; sem Node, sem terminal.

**Num servidor** (Vercel e semelhantes):

```bash
npm run dev      # http://localhost:3000/control
npm run build
```

Os dois alvos saem do mesmo código. Toda a lógica corre no cliente; a única
rota de API é um proxy fino que esconde uma chave Gemini, e está **desligada
por omissão** — um URL público com a chave do dono é um convite a gastar-lhe a
quota. Defina `GEMINI_SERVER_KEY_ENABLED=1` apenas numa instalação privada.

## Primeira utilização

O assistente pergunta duas coisas: que idiomas fala você e que idiomas fala a
audiência. Todo o resto é derivado — o idioma das legendas é o primeiro idioma
da sala, e as duas transcrições guardadas são a sua e a deles. Um colega
português a apresentar para uma audiência inglesa usa a mesma build com valores
diferentes.

A única escolha que vale a pena perceber é **fixo vs auto para o microfone**:

| | Fixo — você diz qual o idioma | Auto — o modelo deteta-o |
|---|---|---|
| Atraso da legenda | **~0,15 s** (medido) | ~3 s (medido) |
| Texto parcial ao vivo | sim, para si | não |
| Limites diários | nenhuns | quota Gemini partilhada |
| Chave de API | não é precisa | obrigatória |
| Tem de se lembrar | premir o chip do canal antes de mudar | de nada |

**Recomendado: microfone fixo.** Você sabe em que idioma vai falar a seguir, e
assim o canal mais falador fica completamente fora da quota. Ambos os canais
são percorridos pelo seu chip no painel — `EN → PT → RU → AUTO` — e a mudança
aplica-se a uma sessão a decorrer, sem a reiniciar. O `AUTO` só aparece quando
existe uma chave Gemini, porque mais nada consegue detetar o idioma.

### Porque o canal da sala precisa do Gemini

A Web Speech API não permite escolher a entrada: ouve o que o sistema chama de
microfone predefinido, não aceita um `MediaStream`, e o Chrome não executa dois
reconhecedores ao mesmo tempo. O áudio da reunião chega como fluxo de captura,
por isso só pode ir para um fornecedor que aceite fluxos. É essa toda a razão
para o Gemini existir no projeto, e é por isso que o canal da sala o usa mesmo
com o idioma fixo — aí fixar é uma pista para o modelo, não outro motor.

Efeito secundário que vale a pena conhecer: como a sala já passa por um modelo,
a **deteção automática de idioma ali é gratuita**. Uma pergunta em inglês entra
no registo como inglês, e não como uma papa fonética.

## Dinheiro

Nada é obrigatório para usar a aplicação: com o microfone fixo e sem chave,
continua a ter legendas e as duas transcrições; só o canal da sala fica calado.

Duas proteções, porque «cerca de trinta cêntimos» não é coisa para aceitar de
confiança:

- **Um limite rígido de pedidos** definido nas definições. Ele pára o envio. Os
  alertas de orçamento da Google chegam depois do facto e não param nada.
- **Um contador de gasto ao vivo** no painel, calculado a partir da contagem
  real de tokens que o Gemini devolve em cada resposta. Sem sondagens, sem
  atraso de faturação.

Chaves gratuitas permitem cerca de dez pedidos por minuto; a aplicação respeita
isso com uma janela deslizante, em vez de disparar até apanhar um 429. Diga-lhe
nas definições se a chave é gratuita ou faturada — a API não o reporta, e errar
significa 429 nas primeiras frases.

## Uma apresentação em vários idiomas

Escolha vários PDF de uma vez — a mesma apresentação composta em idiomas
diferentes. O idioma de cada um é adivinhado pelo nome (`talk-pt.pdf`) mas é
sempre mostrado para confirmação: abrir um ficheiro português como inglês
poria o texto errado à frente da sala, e só daria por isso a meio.

Todas as versões têm de ter o mesmo número de diapositivos; a que não tiver é
descartada com uma mensagem, e não em silêncio. Feito isto, o `Ler em` muda a
conversa, a legenda **e o diapositivo** ao mesmo tempo, mantendo o seu lugar —
mudar de idioma não o move dentro da apresentação.

## Teclas

Poucas de propósito. Tudo o resto tem um botão à vista, e uma tecla ao lado de
um botão só obriga a decorar mais uma coisa.

| Tecla | Ação |
|---|---|
| `→` `Space` `PgDn` | diapositivo seguinte |
| `←` `PgUp` | diapositivo anterior |
| `Home` `End` | primeiro / último diapositivo |
| `Tab` | forma de anotação: retângulo → elipse → seta → marcador |
| `Q` / `Shift+Q` | limpar anotações deste diapositivo / de todos |

Os diapositivos também mudam por voz: diga **seguinte** ou **anterior** — em
qualquer dos três idiomas — como uma frase isolada. Dito no meio de uma frase é
só uma palavra e é ignorado, e uma frase tomada como comando não vai para o
registo: é controlo, não algo dito à sala.

Arraste sobre o diapositivo para desenhar; o marcador desenha à mão livre, para
rodear e destacar. Prima uma forma existente para a arrastar para outro sítio.
Clique numa forma para a apagar, clique com o botão direito para anular a
última. **O PDF nunca é alterado** — as anotações vivem numa camada separada, e
o ficheiro fica igual byte a byte.

O painel de ferramentas aparece quando o cursor chega ao topo do diapositivo,
para não surgir sempre que o rato atravessa o diapositivo.

## Resultado

Duas transcrições completas da reunião inteira, cada uma inteiramente num
idioma, com os dois lados por ordem cronológica: `transcript-en.md`,
`transcript-pt.md` (os nomes seguem o seu perfil). Mais um registo completo com
os originais e uma lista só do que foi marcado, para dar seguimento. Estão os
três no menu `⋯`.

O painel da conversa mostra **um** idioma de cada vez, por omissão o da
audiência — o registo é algo que se entrega aos participantes, portanto são
eles que o vão ler. O `Ler em` troca-o; um idioma que não seja uma das duas
transcrições guardadas é traduzido em bloco no próprio dispositivo.

## Organização do código

```
app/          duas rotas: /control (tudo) e /present (um desenhador simples)
components/   peças de apresentação, sem lógica de negócio
hooks/        useChannels, useDeck, useElementSize
lib/          tipos, store, geometria, constantes, formatação
lib/speech/   a interface SpeechProvider e as suas implementações
tools/        probe.html — verifica uma máquina antes de uma sessão a sério
docs/         requisitos, e a apresentação sobre como isto foi construído
```

Algumas escolhas deliberadas:

- **`lib/constants.ts`** guarda todos os limiares e preços. Números mágicos
  espalhados afastam-se uns dos outros e começam a contradizer-se.
- **`lib/geometry.ts`** guarda o encaixe, a deteção de cliques e os caminhos das
  formas — é o mesmo cálculo visto de sítios diferentes.
- **`lib/ui-prefs.ts`** guarda todas as strings. Nada é escrito na marcação, ou
  a interface portuguesa fica meia inglesa.
- **As classes de componente vivem em `app/globals.css`**, e não em cadeias de
  utilitários na marcação: elementos iguais devem parecer iguais sem copiar uma
  dúzia de classes, e mudar o aspeto de um botão deve ser uma só edição.
- **`SpeechProvider`** é a costura. Acrescentar um motor é um ficheiro novo, não
  uma alteração à interface.
- **Sem diálogos nativos.** `confirm()` e `prompt()` aparecem por cima do ecrã
  partilhado, a sala lê-os, e bloqueiam a página — reconhecimento incluído —
  até alguém os fechar.

## Desenvolvimento

```bash
npm run typecheck
npm run build:check                # compilar sem estragar um dev server a correr
node scripts/make-test-deck.mjs    # PDF de teste com 12 páginas, paisagem
```

`next build` e `next dev` escrevem ambos em `.next` e atropelam-se, o que atira
um dev server a correr para erros 500 até ser reiniciado. O `build:check`
compila para uma pasta própria. O `build:static` continua a não poder correr ao
mesmo tempo que o `dev` — o modo de exportação mexe na cache partilhada seja
qual for a pasta de compilação.

`tools/probe.html` verifica uma máquina antes de uma sessão a sério: pares do
Translator, Web Speech, captura de áudio do sistema, latência do Gemini e o seu
ritmo de fala. Abra-o no Chrome de destino. Já mudou a arquitetura uma vez — o
reconhecimento do navegador, medido, veio vinte vezes mais rápido do que estava
orçamentado, e é por isso que o microfone não vai à nuvem.

## Limites conhecidos

- A Web Speech serve exatamente um canal; a sala precisa de um modelo na nuvem.
- Se as palavras sobrevivem ao ciclo de reinício dela ao longo de uma
  apresentação longa **ainda não foi medido**. Fale três minutos seguidos e
  procure falhas.
- A captura de áudio do sistema é uma história de Windows. No macOS o Chrome só
  oferece áudio de separador, por isso o canal da sala precisa do Teams num
  separador do Chrome ou de um dispositivo de entrada virtual — e um seletor de
  dispositivo para esse canal ainda não está feito.
- Apresentações em retrato funcionam, mas desperdiçam quase toda a área
  partilhada. Paisagem 16:9.
- Em `file://` o pdf.js corre na thread principal — o Chrome recusa workers a
  partir de URL de ficheiro. Só se nota na primeira renderização.
