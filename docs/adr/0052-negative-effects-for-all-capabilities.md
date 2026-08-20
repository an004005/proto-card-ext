# 모든 Capability는 -2~4 유효 수치를 사용한다

장비와 임시 효과를 합산한 여섯 Capability의 유효 범위는 모두 -2~4다. 요구치 비교는 항상 `max(0, 유효 Capability)`로 수행하므로 음수는 새로운 하드 게이트가 되지 않고, 해당 Capability의 불리한 현장 규칙만 만든다. 이 결정은 Mobility와 Stealth에만 음수 페널티를 적용한 기존 결정을 확장한다.

Perception 음수는 정보를 숨기되 거짓 정보를 만들지 않는다. Hacking 음수는 전자 보안 장치에 흔적을, Force 음수는 Force 행동에 더 큰 소음과 흔적을, Deception 음수는 가짜 목표의 짧은 유지와 흔적을 만든다. Mobility와 Stealth의 음수 효과는 각각 이동 시간 증가와 이동 소음·흔적 증가를 유지한다.
