const { Chess } = require('chess.js');
const { gameStore } = require('../../utils');

const UNICODE_PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

const BOT_JID = 'bot';

function renderBoard(fen) {
    const rows = fen.split(' ')[0].split('/');
    let board = '';
    const labels = ['8', '7', '6', '5', '4', '3', '2', '1'];

    for (let r = 0; r < 8; r++) {
        let row = `${labels[r]} `;
        for (const ch of rows[r]) {
            if (ch >= '1' && ch <= '8') {
                row += '▢ '.repeat(parseInt(ch));
            } else {
                row += (UNICODE_PIECES[ch] || '?') + ' ';
            }
        }
        board += row + '\n';
    }
    board += '  a b c d e f g h';
    return '```\n' + board + '\n```';
}

function getGameStatusText(chess) {
    if (chess.isCheckmate()) return '⚠️ *Checkmate!*';
    if (chess.isStalemate()) return '🤝 *Stalemate!*';
    if (chess.isDraw()) return '🤝 *Draw!*';
    if (chess.isThreefoldRepetition()) return '🤝 *Draw by repetition!*';
    if (chess.isInsufficientMaterial()) return '🤝 *Draw — insufficient material!*';
    if (chess.inCheck()) return '⚠️ *Check!*';
    return '';
}

function isChessMove(text) {
    return /^[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[KQRBNP])?[+#]?$|^O-O(?:-O)?[+#]?$/i.test(text.trim());
}

function getTargetFromMsg(msg, args) {
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentions.length > 0) return mentions[0];
    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (quotedSender) return quotedSender;
    if (args[0]) {
        const num = args[0].replace('@', '').replace(/[^0-9]/g, '');
        if (num) return `${num}@s.whatsapp.net`;
    }
    return null;
}

function isPlayingBot(game) {
    return game && game.players[1] === BOT_JID;
}

function formatPlayer(jid) {
    if (jid === BOT_JID) return 'TITAN Bot';
    return `@${jid.split('@')[0]}`;
}

function mentionList(jids) {
    const mentions = jids.filter(j => j !== BOT_JID);
    const text = jids.map(j => j === BOT_JID ? 'TITAN Bot' : `@${j.split('@')[0]}`).join(' vs ');
    return { text, mentions };
}

// ============================================================
// CHESS AI ENGINE
// ============================================================

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const PST_PAWN = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,  5, 10, 25, 25, 10,  5,  5],
    [0,  0,  0, 20, 20,  0,  0,  0],
    [5, -5,-10,  0,  0,-10, -5,  5],
    [5, 10, 10,-20,-20, 10, 10,  5],
    [0,  0,  0,  0,  0,  0,  0,  0]
];

const PST_KNIGHT = [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
];

const PST_BISHOP = [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
];

const PST_ROOK = [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  5,  5,  0,  0,  0]
];

const PST_QUEEN = [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,  0,  5,  5,  5,  5,  0, -5],
    [0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
];

const PST_KING = [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20, 20,  0,  0,  0,  0, 20, 20],
    [20, 30, 10,  0,  0, 10, 30, 20]
];

const PST_MAP = { p: PST_PAWN, n: PST_KNIGHT, b: PST_BISHOP, r: PST_ROOK, q: PST_QUEEN, k: PST_KING };

function evaluateBoard(chess) {
    const board = chess.board();
    let score = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            const val = PIECE_VALUES[piece.type];
            const pst = PST_MAP[piece.type][r][c];
            const sign = piece.color === 'w' ? 1 : -1;
            score += sign * (val + pst);
        }
    }
    return score;
}

function minimax(chess, depth, alpha, beta, isMaximizing) {
    if (depth === 0 || chess.isGameOver()) {
        if (chess.isCheckmate()) return isMaximizing ? -100000 + (3 - depth) : 100000 - (3 - depth);
        if (chess.isStalemate() || chess.isDraw()) return 0;
        return evaluateBoard(chess);
    }

    const moves = chess.moves({ verbose: true });
    moves.sort((a, b) => {
        const aVal = a.captured ? PIECE_VALUES[a.captured] + (a.promotion ? 800 : 0) : 0;
        const bVal = b.captured ? PIECE_VALUES[b.captured] + (b.promotion ? 800 : 0) : 0;
        return bVal - aVal;
    });

    if (isMaximizing) {
        let maxEval = -Infinity;
        for (const move of moves) {
            chess.move(move.san);
            const ev = minimax(chess, depth - 1, alpha, beta, false);
            chess.undo();
            maxEval = Math.max(maxEval, ev);
            alpha = Math.max(alpha, ev);
            if (beta <= alpha) break;
        }
        return maxEval;
    } else {
        let minEval = Infinity;
        for (const move of moves) {
            chess.move(move.san);
            const ev = minimax(chess, depth - 1, alpha, beta, true);
            chess.undo();
            minEval = Math.min(minEval, ev);
            beta = Math.min(beta, ev);
            if (beta <= alpha) break;
        }
        return minEval;
    }
}

function findBestMove(chess, depth = 3) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    moves.sort((a, b) => {
        const aVal = a.captured ? PIECE_VALUES[a.captured] + (a.promotion ? 800 : 0) : 0;
        const bVal = b.captured ? PIECE_VALUES[b.captured] + (b.promotion ? 800 : 0) : 0;
        return bVal - aVal;
    });

    let bestMove = moves[0];
    let bestScore = -Infinity;
    const isWhite = chess.turn() === 'w';

    for (const move of moves) {
        chess.move(move.san);
        const score = minimax(chess, depth - 1, -Infinity, Infinity, !isWhite);
        chess.undo();

        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }

    return bestMove;
}

// ============================================================
// COMMAND HANDLER
// ============================================================

async function handleChess(sock, msg, jid, sender, cmd, args, text, owner, cmdStart, sendWithLogo) {
    const game = gameStore.get(jid);

    switch (cmd) {
        case 'chess': {
            if (game && game.status === 'active') {
                return sendWithLogo('♟️ A chess game is already in progress! Use `.board` to see it.');
            }
            if (game && game.status === 'lobby') {
                return sendWithLogo('♟️ A chess challenge is already pending! Use `.accept` or `.cancel`.');
            }

            const target = getTargetFromMsg(msg, args);

            if (!target) {
                const chess = new Chess();
                gameStore.set(jid, {
                    type: 'chess',
                    status: 'active',
                    players: [sender, BOT_JID],
                    data: { chess, moves: [], drawOffer: null }
                });

                const board = renderBoard(chess.fen());
                await sock.sendMessage(jid, {
                    text: `♟️ *Chess vs TITAN Bot*\n\nYou play White. I play Black.\n\n${board}\n\n👉 Your turn! Type \`.move e4\` or just \`e4\``,
                    mentions: [sender]
                });
                return;
            }

            if (target === sender) {
                return sendWithLogo('❌ You cannot challenge yourself!');
            }

            gameStore.set(jid, {
                type: 'chess',
                status: 'lobby',
                players: [sender, target],
                data: null
            });

            await sock.sendMessage(jid, {
                text: `♟️ *Chess Challenge!*\n\n@${sender.split('@')[0]} challenges @${target.split('@')[0]}!\n\nType \`.accept\` to accept.\nChallenge expires in 60 seconds.`,
                mentions: [sender, target]
            });

            setTimeout(() => {
                const cur = gameStore.get(jid);
                if (cur && cur.type === 'chess' && cur.status === 'lobby') {
                    gameStore.delete(jid);
                    sock.sendMessage(jid, { text: '⏰ Chess challenge expired.' }).catch(() => {});
                }
            }, 60000);
            break;
        }

        case 'accept': {
            if (!game || game.type !== 'chess' || game.status !== 'lobby') {
                return sendWithLogo('❌ No pending chess challenge to accept.');
            }
            if (game.players[1] !== sender) {
                return sendWithLogo('❌ You were not challenged!');
            }

            const chess = new Chess();
            game.data = { chess, moves: [], drawOffer: null };
            game.status = 'active';
            gameStore.set(jid, game);

            const board = renderBoard(chess.fen());
            const turnPlayer = game.players[0];
            await sock.sendMessage(jid, {
                text: `♟️ *Game Started!*\n\n@${game.players[0].split('@')[0]} (White) vs @${game.players[1].split('@')[0]} (Black)\n\n${board}\n\n👉 Turn: @${turnPlayer.split('@')[0]} (White)`,
                mentions: [...game.players, turnPlayer]
            });
            break;
        }

        case 'cancel': {
            if (!game || game.type !== 'chess' || game.status !== 'lobby') {
                return sendWithLogo('❌ No pending chess challenge to cancel.');
            }
            if (game.players[0] !== sender) {
                return sendWithLogo('❌ Only the challenger can cancel.');
            }
            gameStore.delete(jid);
            await sendWithLogo('❌ Chess challenge cancelled.');
            break;
        }

        case 'move': {
            if (!game || game.type !== 'chess' || game.status !== 'active') {
                return sendWithLogo('❌ No active chess game. Start one with \`.chess\` (vs bot) or \`.chess @player\` (vs human).');
            }
            const result = await makeChessMove(sock, jid, sender, args.join(' '), msg);
            if (result && result.error) {
                await sendWithLogo(result.error);
            }
            break;
        }

        case 'resign': {
            if (!game || game.type !== 'chess' || game.status !== 'active') {
                return sendWithLogo('❌ No active chess game.');
            }
            const playerIdx = game.players.indexOf(sender);
            if (playerIdx === -1) {
                return sendWithLogo('❌ You are not in this game.');
            }
            const winner = game.players[1 - playerIdx];
            gameStore.delete(jid);
            const winnerName = winner === BOT_JID ? 'TITAN Bot' : `@${winner.split('@')[0]}`;
            const mentions = winner === BOT_JID ? [] : [winner];
            await sock.sendMessage(jid, {
                text: `🏳️ @${sender.split('@')[0]} resigns! ${winnerName} wins! 🎉`,
                mentions
            });
            break;
        }

        case 'draw': {
            if (!game || game.type !== 'chess' || game.status !== 'active') {
                return sendWithLogo('❌ No active chess game.');
            }
            if (isPlayingBot(game)) {
                return sendWithLogo('🤝 Draw offer declined. The Bot fights on!');
            }
            if (!game.players.includes(sender)) {
                return sendWithLogo('❌ You are not in this game.');
            }
            if (game.data.drawOffer === sender) {
                return sendWithLogo('❌ You already offered a draw. Wait for your opponent.');
            }
            if (game.data.drawOffer) {
                gameStore.delete(jid);
                await sock.sendMessage(jid, {
                    text: `🤝 Draw agreed! Game ends in a tie.`,
                    mentions: game.players
                });
            } else {
                game.data.drawOffer = sender;
                gameStore.set(jid, game);
                const opponent = game.players.find(p => p !== sender);
                await sock.sendMessage(jid, {
                    text: `🤝 @${sender.split('@')[0]} offers a draw. Type \`.draw\` to accept.`,
                    mentions: [opponent]
                });
            }
            break;
        }

        case 'board': {
            if (!game || game.type !== 'chess' || game.status !== 'active') {
                return sendWithLogo('❌ No active chess game.');
            }
            const chess = game.data.chess;
            const board = renderBoard(chess.fen());
            const idx = game.data.moves.length % 2;
            const color = idx === 0 ? 'White' : 'Black';
            const cp = game.players[idx];
            const status = getGameStatusText(chess);
            const moves = game.data.moves.slice(-10).join(' ');

            let turnLine;
            if (isPlayingBot(game)) {
                turnLine = idx === 0
                    ? `👉 Your turn (White)`
                    : `🤖 Bot is thinking...`;
            } else {
                turnLine = `👉 Turn: @${cp.split('@')[0]} (${color})`;
            }

            const text = `${board}\n\n📜 *Moves:* ${moves || '—'}\n\n${turnLine}${status ? '\n' + status : ''}`;
            const m = cp === BOT_JID ? [] : [cp];
            await sock.sendMessage(jid, { text, mentions: m });
            break;
        }

        default:
            break;
    }
}

// ============================================================
// MOVE PROCESSOR (used by both .move command and game input)
// ============================================================

async function makeChessMove(sock, jid, sender, moveStr, msg) {
    const game = gameStore.get(jid);
    if (!game || game.type !== 'chess' || game.status !== 'active') {
        return { error: '❌ No active chess game.' };
    }

    const playerIdx = game.players.indexOf(sender);
    const isVsBot = isPlayingBot(game);

    if (!isVsBot && playerIdx === -1) {
        return; // silently ignore non-players in PvP
    }

    if (isVsBot && playerIdx !== 0) {
        if (playerIdx === 1) return; // bot's own moves are triggered internally
        return;
    }

    const expectedIdx = game.data.moves.length % 2;
    if (playerIdx !== expectedIdx) {
        if (isVsBot) {
            return { error: `❌ It's not your turn! Wait for the Bot to move.` };
        }
        return { error: `❌ It's not your turn! Wait for @${game.players[expectedIdx].split('@')[0]}.` };
    }

    if (!moveStr) {
        return;
    }

    const chess = game.data.chess;
    try {
        const move = chess.move(moveStr);
        game.data.moves.push(move.san);
        game.data.drawOffer = null;

        const board = renderBoard(chess.fen());
        const status = getGameStatusText(chess);

        if (chess.isGameOver()) {
            let result;
            if (chess.isCheckmate()) {
                result = `♟️ *Checkmate!* @${sender.split('@')[0]} wins! 🎉\n${board}`;
            } else if (chess.isStalemate()) {
                result = `♟️ *Stalemate!* It's a draw!\n${board}`;
            } else if (chess.isDraw()) {
                result = `♟️ *Draw!*\n${board}`;
            } else {
                result = `♟️ *Game Over!*\n${board}`;
            }
            gameStore.delete(jid);
            // Show the final board before deleting
            await sock.sendMessage(jid, { text: `✅ *${move.san}*${status ? ' — ' + status : ''}\n\n${board}` });
            await sock.sendMessage(jid, { text: result, mentions: isVsBot ? [sender] : game.players });
            return {};
        }

        gameStore.set(jid, game);
        const nextIdx = game.data.moves.length % 2;
        const nextPlayer = game.players[nextIdx];

        // If playing vs bot, trigger AI move
        if (isVsBot && nextPlayer === BOT_JID) {
            await sock.sendMessage(jid, { text: `✅ *${move.san}*\n\n${board}\n\n🤖 Bot is thinking...` });

            const botMove = findBestMove(chess, 3);
            if (!botMove) {
                gameStore.delete(jid);
                await sock.sendMessage(jid, { text: `♟️ *Game Over!* Bot has no legal moves.\n${board}` });
                return {};
            }

            try {
                chess.move(botMove.san);
            } catch (e) {
                chess.move(botMove.lan);
            }
            game.data.moves.push(botMove.san);
            game.data.drawOffer = null;

            const botBoard = renderBoard(chess.fen());
            const botStatus = getGameStatusText(chess);

            if (chess.isGameOver()) {
                let result;
                if (chess.isCheckmate()) {
                    result = `♟️ *Checkmate!* 🤖 TITAN Bot wins! 🎉\n${botBoard}`;
                } else if (chess.isStalemate()) {
                    result = `♟️ *Stalemate!* It's a draw!\n${botBoard}`;
                } else if (chess.isDraw()) {
                    result = `♟️ *Draw!*\n${botBoard}`;
                } else {
                    result = `♟️ *Game Over!*\n${botBoard}`;
                }
                gameStore.delete(jid);
                await sock.sendMessage(jid, { text: result, mentions: [sender] });
                return {};
            }

            gameStore.set(jid, game);
            const statusLine = botStatus ? botStatus + '\n\n' : '';
            await sock.sendMessage(jid, {
                text: `🤖 *${botMove.san}*\n\n${statusLine}${botBoard}\n\n👉 Your turn (White)`,
                mentions: [sender]
            });
            return {};
        }

        // Human vs Human: show next turn
        const nextColor = nextIdx === 0 ? 'White' : 'Black';
        await sock.sendMessage(jid, {
            text: `${status ? status + '\n\n' : ''}${board}\n\n👉 Turn: @${nextPlayer.split('@')[0]} (${nextColor})`,
            mentions: [nextPlayer]
        });
        return {};
    } catch (e) {
        const legalMoves = chess.moves({ verbose: false });
        return { error: `❌ Illegal move: "${moveStr}".\n\nLegal moves: ${legalMoves.join(', ')}` };
    }
}

module.exports = { handleChess, renderBoard, isChessMove, makeChessMove };
