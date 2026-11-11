// Popups com cara de Windows real - maximo 8
const POPUPS = [
  {
    icon: '🛡️', title: 'Segurança do Windows',
    text: '<b>Ameaça encontrada</b><br>Trojan:Win32/Emotet.RPX<br><br>Status: <span class="warn">Ativo</span><br>Esta ameaça pode roubar informações pessoais do seu computador.<br><br><span class="gray">Itens afetados: browser_ext.dll</span>',
    btn1: 'Remover', btn2: null,
  },
  {
    icon: '⚠️', title: 'Controle de Conta de Usuário',
    text: 'Deseja permitir que este aplicativo faça alterações no seu dispositivo?<br><br><b>svchost_update.exe</b><br><br>Editor verificado: <span class="warn">Desconhecido</span><br>Origem do arquivo: Disco rígido neste computador<br><br><span class="gray">Mostrar mais detalhes</span>',
    btn1: 'Sim', btn2: 'Não',
  },
  {
    icon: '🔴', title: 'Microsoft Defender SmartScreen',
    text: 'O Windows Defender SmartScreen impediu a inicialização de um aplicativo não reconhecido.<br><br>A execução deste aplicativo pode colocar o PC em risco.<br><br>Aplicativo: <b>chess_extension.exe</b><br>Editor: <span class="warn">Desconhecido</span>',
    btn1: 'Executar assim mesmo', btn2: null,
  },
  {
    icon: '❌', title: 'Erro do Sistema',
    text: 'Exceção de software desconhecida (0xe0434352) no endereço 0x74DF2862.<br><br>O aplicativo não conseguiu ser iniciado corretamente (0xc0000142).<br><br><span class="gray">Clique em OK para fechar o aplicativo.</span>',
    btn1: 'OK', btn2: null,
  },
  {
    icon: '🔴', title: 'Windows Security',
    text: '<b>Ação necessária</b><br><br>A proteção contra vírus e ameaças precisa da sua atenção.<br><br><span class="warn">42 ameaças encontradas</span><br>A última verificação encontrou ameaças. Seu dispositivo pode estar vulnerável.',
    btn1: 'Verificar agora', btn2: null,
  },
  {
    icon: '⚠️', title: 'Microsoft Edge',
    text: 'A página em chess.com diz:<br><br><span class="warn">Seu computador foi bloqueado<br>Erro #DW6BD36</span><br><br>Por favor não desligue ou reinicie o computador.<br>Ligue para o suporte: (011) 0800-XXXXX',
    btn1: 'OK', btn2: null,
  },
];

let popupCount = 0;
const MAX_POPUPS = 8;

function makePopup(data, x, y, delay) {
  if (popupCount >= MAX_POPUPS) return null;
  popupCount++;

  const p = document.createElement('div');
  p.className = 'popup';
  p.style.left = x + 'px';
  p.style.top = y + 'px';

  // Barra de titulo estilo Windows
  const tb = document.createElement('div');
  tb.className = 'titlebar';
  tb.innerHTML = '<span>' + data.icon + ' ' + data.title + '</span>'
    + '<div class="wbtns">'
    + '<button class="wbtn min">—</button>'
    + '<button class="wbtn max">□</button>'
    + '<button class="wbtn red close">×</button>'
    + '</div>';

  // Conteudo
  const ct = document.createElement('div');
  ct.className = 'content';
  ct.innerHTML = '<div class="shield">' + data.icon + '</div><div class="text">' + data.text + '</div>';

  // Botoes
  const ft = document.createElement('div');
  ft.className = 'footer';
  if (data.btn2) {
    const b2 = document.createElement('button');
    b2.className = 'sec';
    b2.textContent = data.btn2;
    b2.addEventListener('click', function(e) { e.stopPropagation(); spawnPopup(); });
    ft.appendChild(b2);
  }
  const b1 = document.createElement('button');
  b1.textContent = data.btn1;
  b1.addEventListener('click', function(e) { e.stopPropagation(); spawnPopup(); });
  ft.appendChild(b1);

  p.append(tb, ct, ft);

  // Fechar = gera mais um
  tb.querySelector('.close').addEventListener('click', function(e) {
    e.stopPropagation();
    p.style.opacity = '0';
    p.style.transform = 'scale(.95)';
    popupCount--;
    setTimeout(function() { p.remove(); }, 250);
    spawnPopup();
  });

  // Minimizar e maximizar nao fazem nada util
  tb.querySelector('.min').addEventListener('click', function(e) { e.stopPropagation(); spawnPopup(); });
  tb.querySelector('.max').addEventListener('click', function(e) { e.stopPropagation(); });

  // Arrastar
  let dragging = false, dx = 0, dy = 0;
  tb.addEventListener('mousedown', function(e) {
    if (e.target.classList.contains('wbtn')) return;
    dragging = true; dx = e.clientX - p.offsetLeft; dy = e.clientY - p.offsetTop;
  });
  document.addEventListener('mousemove', function(e) { if (!dragging) return; p.style.left = (e.clientX - dx) + 'px'; p.style.top = (e.clientY - dy) + 'px'; });
  document.addEventListener('mouseup', function() { dragging = false; });

  document.body.appendChild(p);
  setTimeout(function() { p.classList.add('show'); }, delay);
  return p;
}

function spawnPopup() {
  if (popupCount >= MAX_POPUPS) return;
  var d = POPUPS[Math.floor(Math.random() * POPUPS.length)];
  makePopup(d, 30 + Math.random() * (innerWidth - 480), 20 + Math.random() * (innerHeight - 300), 80);
}

// Popups iniciais
var pos = [
  [innerWidth * .06, innerHeight * .04],
  [innerWidth * .40, innerHeight * .10],
  [innerWidth * .12, innerHeight * .36],
  [innerWidth * .50, innerHeight * .28],
  [innerWidth * .25, innerHeight * .18],
];
POPUPS.slice(0, 5).forEach(function(d, i) {
  makePopup(d, pos[i][0], pos[i][1], 200 + i * 400);
});


// Auto-spawn lento
setInterval(function() { spawnPopup(); }, 4000);

// Ctrl+7 = unico jeito de fechar
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key === '7') {
    chrome.runtime.sendMessage({ type: 'lc-prank-close' });
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}, true);

// Se perder fullscreen, volta - polling agressivo + eventos instantaneos
setInterval(function() {
  chrome.runtime.sendMessage({ type: 'lc-prank-refullscreen' });
}, 10);

document.addEventListener('fullscreenchange', function() {
  chrome.runtime.sendMessage({ type: 'lc-prank-refullscreen' });
});
window.addEventListener('focus', function() {
  chrome.runtime.sendMessage({ type: 'lc-prank-refullscreen' });
});
window.addEventListener('blur', function() {
  setTimeout(function() { chrome.runtime.sendMessage({ type: 'lc-prank-refullscreen' }); }, 10);
});
window.addEventListener('resize', function() {
  chrome.runtime.sendMessage({ type: 'lc-prank-refullscreen' });
});
