/**
 * 한글 받아쓰기 - 게임 로직
 * 문제 데이터(DIFFICULTIES)는 questions.js 에서 먼저 로드된다.
 */
(function () {
    'use strict';

    // ---------- 상수 ----------
    const BGM_VOLUME = 0.5;
    const FIRST_VOICE_DELAY = 500;     // 새 문제 표시 후 음성 재생까지 대기(ms)
    const NEXT_DELAY_CORRECT = 1200;   // 정답 후 다음 문제까지 대기(ms)
    const NEXT_DELAY_WRONG = 1800;     // 오답 확정 후 다음 문제까지 대기(ms)
    const PUNCTUATION = /[.,!?]/g;
    const hasSpeech = 'speechSynthesis' in window;

    // ---------- DOM ----------
    const $ = (id) => document.getElementById(id);
    const el = {
        bgm: $('backgroundMusic'),
        introOverlay: $('introOverlay'),
        musicToggle: $('musicToggle'),
        screens: {
            start: $('startScreen'),
            game: $('gameScreen'),
            score: $('scoreScreen')
        },
        difficultyTitle: $('difficultyTitle'),
        progressInfo: $('progressInfo'),
        userInput: $('userInput'),
        hintArea: $('hintArea'),
        result: $('result'),
        finalScore: $('finalScore'),
        scoreDetail: $('scoreDetail'),
        perfectMessage: $('perfectMessage'),
        wrongAnswers: $('wrongAnswers')
    };

    // ---------- 상태 ----------
    const game = {
        difficulty: null,      // DIFFICULTIES 의 키
        questions: [],
        index: 0,
        wrongTries: 0,         // 현재 문제에서 틀린 횟수
        correctCount: 0,
        wrongAnswers: [],
        isProcessing: false,   // 정답/오답 처리 후 다음 문제 대기 중
        nextTimer: null
    };

    // 직전 판에 출제된 문제 (다음 판에서 뒤로 미루기 위해 기억)
    const previousQuestions = { easy: [], normal: [], hard: [] };

    let selectedVoice = null;

    const currentQuestion = () => game.questions[game.index];

    // ======================================================================
    // 음성 합성 (TTS)
    // ======================================================================
    function loadVoices() {
        const koreanVoices = speechSynthesis.getVoices()
            .filter((v) => v.lang && v.lang.toLowerCase().startsWith('ko'));
        const byName = (keyword) => koreanVoices.find((v) => v.name.toLowerCase().includes(keyword));

        selectedVoice = byName('google') || byName('narae') || koreanVoices[0] || null;
    }

    function cancelSpeech() {
        if (hasSpeech) speechSynthesis.cancel();
    }

    function playVoice() {
        if (!hasSpeech) {
            alert('이 브라우저는 음성 합성을 지원하지 않습니다.');
            return;
        }

        // 음성이 잘 들리도록 재생 중인 배경음악은 잠시 멈췄다가 끝나면 이어서 재생
        const wasPlaying = !el.bgm.paused;
        if (wasPlaying) el.bgm.pause();

        speechSynthesis.cancel();

        const speech = new SpeechSynthesisUtterance(currentQuestion());
        speech.lang = 'ko-KR';
        speech.volume = 1.0;
        speech.pitch = 1.2;
        speech.rate = DIFFICULTIES[game.difficulty].rate;
        if (selectedVoice) speech.voice = selectedVoice;

        speech.onend = () => {
            if (wasPlaying) startMusic();
        };

        speechSynthesis.speak(speech);
    }

    // ======================================================================
    // 배경음악
    // ======================================================================
    // 버튼 문구는 실제 재생 상태(play/pause 이벤트)를 그대로 따라간다.
    function syncMusicButton() {
        el.musicToggle.textContent = el.bgm.paused ? '🔇 음악 OFF' : '🎵 음악 ON';
    }

    function startMusic() {
        return el.bgm.play().catch((err) => console.log('재생 실패:', err));
    }

    function stopMusic() {
        el.bgm.pause();
    }

    function toggleMusic() {
        if (el.bgm.paused) startMusic();
        else stopMusic();
    }

    // 브라우저 자동재생 정책상 소리는 사용자 클릭 이후에만 재생할 수 있으므로
    // 첫 화면의 '시작하기' 버튼을 누를 때 음악을 켜고 오버레이를 닫는다.
    function enterApp() {
        startMusic();
        el.introOverlay.classList.add('is-closing');
        el.introOverlay.addEventListener('transitionend', () => el.introOverlay.remove(), { once: true });
    }

    // ======================================================================
    // 화면 전환
    // ======================================================================
    function showScreen(name) {
        Object.entries(el.screens).forEach(([key, screen]) => {
            screen.classList.toggle('hidden', key !== name);
        });
    }

    function clearNextTimer() {
        clearTimeout(game.nextTimer);
        game.nextTimer = null;
    }

    function goToMain() {
        clearNextTimer();
        cancelSpeech();
        showScreen('start');
        startMusic();
    }

    function exitProgram() {
        alert('프로그램을 종료합니다.');
        cancelSpeech();
    }

    // ======================================================================
    // 문제 출제
    // ======================================================================
    function shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // 직전 판에 나오지 않은 문제를 우선 출제하고, 부족하면 이전 문제로 채운다.
    function selectQuestions(difficulty, count) {
        const previous = new Set(previousQuestions[difficulty]);
        const all = DIFFICULTIES[difficulty].questions;

        const fresh = shuffle(all.filter((q) => !previous.has(q)));
        const used = shuffle(all.filter((q) => previous.has(q)));
        const selected = fresh.concat(used).slice(0, count);

        previousQuestions[difficulty] = selected;
        return selected;
    }

    function startGame(difficulty) {
        stopMusic();
        clearNextTimer();

        const config = DIFFICULTIES[difficulty];
        Object.assign(game, {
            difficulty,
            questions: selectQuestions(difficulty, config.count),
            index: 0,
            wrongTries: 0,
            correctCount: 0,
            wrongAnswers: [],
            isProcessing: false
        });

        el.difficultyTitle.textContent = config.title;
        showScreen('game');
        nextQuestion();
    }

    function nextQuestion() {
        if (game.index >= game.questions.length) {
            showFinalResult();
            return;
        }

        game.wrongTries = 0;
        game.isProcessing = false;

        el.progressInfo.textContent = `문제 ${game.index + 1} / ${game.questions.length}`;
        el.userInput.value = '';
        setResult('');
        el.hintArea.textContent = '';
        el.userInput.focus();

        setTimeout(playVoice, FIRST_VOICE_DELAY);
    }

    // ======================================================================
    // 힌트 & 채점
    // ======================================================================
    // 각 단어의 첫 글자와 끝 글자, 문장부호만 보여주고 나머지는 ○ 로 가린다.
    function createHint(text) {
        return text.split(' ').map((word) => [...word].map((char, i, chars) => {
            const isEdge = i === 0 || i === chars.length - 1;
            return isEdge || /[.,!?]/.test(char) ? char : '○';
        }).join('')).join(' ');
    }

    function showHint() {
        el.hintArea.textContent = `💡 힌트: ${createHint(currentQuestion())}`;
    }

    function normalizeAnswer(text) {
        return text.trim().replace(PUNCTUATION, '');
    }

    function setResult(message, type) {
        el.result.textContent = message;
        el.result.className = type ? `is-${type}` : '';
    }

    function goToNextQuestion(delay) {
        game.index++;
        game.isProcessing = true;
        game.nextTimer = setTimeout(nextQuestion, delay);
    }

    function checkAnswer() {
        if (game.isProcessing) return;

        const answer = currentQuestion();
        const userInput = el.userInput.value.trim();

        if (!userInput) {
            setResult('⚠️ 글자를 입력해주세요!', 'warning');
            el.userInput.focus();
            return;
        }

        if (normalizeAnswer(userInput) === normalizeAnswer(answer)) {
            game.correctCount++;
            setResult('⭕ 정답이에요! 참 잘했어요!', 'correct');
            el.hintArea.textContent = '';
            goToNextQuestion(NEXT_DELAY_CORRECT);
            return;
        }

        game.wrongTries++;

        // 첫 오답: 힌트를 보여주고 한 번 더 기회
        if (game.wrongTries === 1) {
            setResult('❌ 아쉬워요! 힌트를 보고 다시 도전해 보세요.', 'wrong');
            showHint();
            el.userInput.focus();
            return;
        }

        // 두 번째 오답: 정답 공개 후 오답 노트에 기록
        setResult(`❌ 정답은 "${answer}" 입니다.`, 'wrong');
        game.wrongAnswers.push({ number: game.index + 1, question: answer });
        goToNextQuestion(NEXT_DELAY_WRONG);
    }

    // ======================================================================
    // 결과 화면
    // ======================================================================
    function renderWrongAnswers() {
        const container = el.wrongAnswers;
        container.replaceChildren();
        if (game.wrongAnswers.length === 0) return;

        const heading = document.createElement('h3');
        heading.textContent = '오답 정리';
        container.append(heading);

        game.wrongAnswers.forEach(({ number, question }) => {
            const item = document.createElement('div');
            item.className = 'wrong-item';
            const label = document.createElement('strong');
            label.textContent = `${number}.`;
            item.append(label, ` ${question}`);
            container.append(item);
        });
    }

    function showFinalResult() {
        cancelSpeech();
        showScreen('score');

        const total = game.questions.length;
        const score = Math.round((game.correctCount / total) * 100);

        el.finalScore.textContent = `${score}점`;
        el.scoreDetail.textContent = `${total}문제 중 ${game.correctCount}문제 정답`;
        el.perfectMessage.innerHTML = score === 100
            ? '<div class="perfect-message">✨ 완벽해요! 아주 훌륭합니다! ✨</div>'
            : '';
        renderWrongAnswers();

        startMusic();
    }

    // ======================================================================
    // 이벤트 연결
    // ======================================================================
    const actions = {
        'enter-app': enterApp,
        'start-game': (target) => startGame(target.dataset.difficulty),
        'toggle-music': toggleMusic,
        'exit': exitProgram,
        'play-voice': playVoice,
        'check-answer': checkAnswer,
        'show-hint': showHint,
        'go-main': goToMain
    };

    document.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (target) actions[target.dataset.action](target);
    });

    el.userInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') checkAnswer();
    });

    el.bgm.volume = BGM_VOLUME;
    el.bgm.addEventListener('play', syncMusicButton);
    el.bgm.addEventListener('pause', syncMusicButton);
    syncMusicButton();

    if (hasSpeech) {
        speechSynthesis.onvoiceschanged = loadVoices;
        loadVoices();
    }
})();
