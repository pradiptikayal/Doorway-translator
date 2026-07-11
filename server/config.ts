export const CLARIFICATION_KEYWORDS = [
  "repeat",
  "again",
  "pardon",
  "didn't catch",
  "did not catch",
  "say that again",
  "what did you say",
  "huh",
  "confused",
  "mumbled",
  "overlapping",
  "excuse me",
];

export const CLARIFICATION_MESSAGES: Record<string, { lowConfidence: string; needRephrase: string; confused: string }> = {
  "English": {
    lowConfidence: "Your speech may be too quiet, noisy, or overlapping. Please repeat more clearly in your native language.",
    needRephrase: "The other participant may need a slower or clearer explanation. Please repeat or rephrase.",
    confused: "The other participant seems confused or hesitating. Consider slowing down or clarifying your last point."
  },
  "Hindi": {
    lowConfidence: "आपकी आवाज़ बहुत धीमी, शोरगुल वाली या ओवरलैपिंग हो सकती है। कृपया अपनी मूल भाषा में अधिक स्पष्ट रूप से दोहराएं।",
    needRephrase: "दूसरे प्रतिभागी को अधिक धीमी या स्पष्ट व्याख्या की आवश्यकता हो सकती है। कृपया दोहराएं या दूसरे शब्दों में कहें।",
    confused: "दूसरा प्रतिभागी भ्रमित या संकोच में लग रहा है। गति धीमी करने या अपनी अंतिम बात स्पष्ट करने पर विचार करें।"
  },
  "Spanish": {
    lowConfidence: "Es posible que hables muy bajo, con ruido o que se superponga la voz. Repite más claramente en tu idioma nativo.",
    needRephrase: "Es posible que el otro participant nececite una explicación más lenta o clara. Repite o reformula.",
    confused: "El otro participante parece confundido o duda. Considera hablar más despacio o aclarar tu último punto."
  },
  "Italian": {
    lowConfidence: "La tua voce potrebbe essere troppo bassa, rumorosa o sovrapposta. Ripeti più chiaramente nella tua lingua madre.",
    needRephrase: "L'altro partecipante potrebbe aver bisogno di una spiegazione più lenta o più chiara. Ripeti o riformula.",
    confused: "L'altro partecipante sembra confuso o esitante. Considera di rallentare o di chiarire il tuo ultimo punto."
  },
  "Chinese": {
    lowConfidence: "您的声音可能太小、嘈杂或重叠。请用您的母语更清晰地重复一遍。",
    needRephrase: "另一位参与者可能需要更慢或更清晰的解释。请重复或换个说法。",
    confused: "另一位参与者似乎感到困惑或犹豫。考虑放慢速度或澄清您的最后一个观点。"
  },
  "French": {
    lowConfidence: "Votre voix est peut-être trop basse, bruyante ou superposée. Veuillez répéter plus clairement dans votre langue maternelle.",
    needRephrase: "L'autre participant a peut-être besoin d'une explication plus lente ou plus claire. Veuillez répéter ou reformuler.",
    confused: "L'autre participant semble confus ou hésitant. Pensez à ralentir ou à clarifier votre dernier point."
  },
  "German": {
    lowConfidence: "Ihre Sprache ist möglicherweise zu leise, laut oder überlappend. Bitte wiederholen Sie dies deutlicher in Ihrer Muttersprache.",
    needRephrase: "Der andere Teilnehmer benötigt möglicherweise eine langsamere oder klarere Erklärung. Bitte wiederholen oder formulieren Sie sie um.",
    confused: "Der andere Teilnehmer scheint verwirrt zu sein oder zu zögern. Überlegen Sie, langsamer zu sprechen oder Ihren letzten Punkt zu erklären."
  },
  "Japanese": {
    lowConfidence: "音声が小さすぎる、雑音が多い、または重なっている可能性があります。母国語でもう一度はっきりと繰り返してください。",
    needRephrase: "相手の参加者は、よりゆっくり、または明確な説明を必要としている可能性があります。繰り返すか、言い換えてください。",
    confused: "相手の参加者は困惑しているか、ためらっているようです。話す速度を落とすか、最後の点について説明を加えてください。"
  },
  "Portuguese": {
    lowConfidence: "Sua fala pode estar muito baixa, barulhenta ou sobreposta. Por favor, repita com mais clareza em seu idioma nativo.",
    needRephrase: "O outro participante pode precisar de uma explicação mais lenta ou clara. Por favor, repita ou reformule.",
    confused: "O outro participante parece confuso ou hesitante. Considere falar mais devagar ou esclarecer seu último ponto."
  },
  "Arabic": {
    lowConfidence: "قد يكون كلامك هادئًا جدًا، أو به ضوضاء، أو متداخلًا. يرجى التكرาร بوضوح أكبر بلغتك الأم.",
    needRephrase: "قد يحتاج المشارك الآخر إلى شرح أبطأ أو أكثر وضوحًا. يرجى التكرار أو إعادة صياغة كلامك.",
    confused: "يبدو أن المشارك الآخر مرتبك أو متردد. فكر في الإبطاء أو توضيح نقطتك الأخيرة."
  },
  "Russian": {
    lowConfidence: "Возможно, вы говорите слишком тихо, шумно или перебиваете собеседника. Пожалуйста, повторите более четко на своем родном языке.",
    needRephrase: "Другому участнику может потребоваться более медленное или понятное объяснение. Пожалуйста, повторите или перефразируйте.",
    confused: "Другой участник кажется растерянным или сомневающимся. Попробуйте говорить медленнее или уточнить свою последнюю мысль."
  },
  "Korean": {
    lowConfidence: "목소리가 너무 작거나, 시끄럽거나, 다른 소리와 겹칠 수 있습니다. 모국어로 더 명확하게 다시 말씀해 주세요.",
    needRephrase: "상대방이 더 천천히 또는 명확한 설명을 필요로 할 수 있습니다. 다시 말씀해 주시거나 다른 표현으로 설명해 주세요.",
    confused: "상대방이 혼란스러워하거나 주저하는 것 같습니다. 말을 조금 천천히 하거나 마지막 내용을 명확히 설명해 보세요."
  },
  "Turkish": {
    lowConfidence: "Konuşmanız çok sessiz, gürültülü veya üst üste biniyor olabilir. Lütfen kendi dilinizde daha net bir şekilde tekrarlayın.",
    needRephrase: "Diğer katılımcının daha yavaş veya daha net bir açıklamaya ihtiyacı olabilir. Lütfen tekrarlayın veya farklı şekilde ifade edin.",
    confused: "Diğer katılımcının kafası karışmış veya tereddüt ediyor gibi görünüyor. Lütfen yavaşlamayı veya son söylediğinizi netleştirmeyi düşünün."
  },
  "Dutch": {
    lowConfidence: "Uw spraak is mogelijk te zacht, luidruchtig of overlappend. Herhaal dit duidelicher in uw moedeltaal.",
    needRephrase: "De andere deelnemer heeft mogelijk een langzamere of duidelijkere uitleg nodig. Gelieve te herhalen of te herformuleren.",
    confused: "De andere deelnemer lijkt in de war of aarzelt. Overweeg om langzamer te gaan of uw laatste punt te verduidelijken."
  },
  "Indonesian": {
    lowConfidence: "Suara Anda mungkin terlalu pelan, bising, atau tumpang tindih. Silakan ulangi dengan lebih jelas dalam bahasa ibu Anda.",
    needRephrase: "Peserta lain mungkin memerlukan penjelasan yang lebih lambat atau lebih jelas. Silakan ulangi atau sampaikan dengan kata-lain.",
    confused: "Peserta lain tampak bingung atau ragu-ragu. Coba bicara lebih lambat atau jelaskan poin terakhir Anda."
  },
  "Vietnamese": {
    lowConfidence: "Giọng nói của bạn có thể quá nhỏ, ồn ào hoặc bị chồng chéo. Vui lòng lặp lại rõ ràng hơn bằng ngôn ngữ mẹ đẻ của bạn.",
    needRephrase: "Người tham gia khác có vẻ bối rối hoặc do dự. Cân nhắc nói chậm lại hoặc làm rõ điểm cuối cùng của bạn.",
    confused: "Người tham gia khác có vẻ bối rối hoặc do dự. Cân nhắc nói chậm lại oặc làm rõ điểm cuối cùng của bạn."
  },
  "Thai": {
    lowConfidence: "เสียงของคุณอาจเบาเกินไป มีเสียงรบกวน หรือซ้อนทับกัน กรุณาพูดซ้ำให้ชัดเจนยิ่งขึ้นในภาษาของคุณเอง",
    needRephrase: "ผู้เข้าร่วมอีกฝ่ายอาจต้องการคำอธิบายที่ช้าลงหรือชัดเจนยิ่งขึ้น กรุณาพูดซ้ำหรืออธิบายใหม่",
    confused: "ผู้เข้าร่วมอีกฝ่ายดูเหมือนจะสับสนหรือลังเล ลองพูดช้าลงหรืออธิบายประเด็นสุดท้ายของคุณให้ชัดเจนขึ้น"
  }
};

export function getClarificationMessage(lang: string, type: "lowConfidence" | "needRephrase" | "confused"): string {
  const normalizedLang = lang || "English";
  const messages = CLARIFICATION_MESSAGES[normalizedLang] || CLARIFICATION_MESSAGES["English"];
  return messages[type];
}
