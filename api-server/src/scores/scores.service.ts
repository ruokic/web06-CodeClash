import { BadRequestException, Injectable } from '@nestjs/common';
import { ScoreSubmissionDto } from './dto/score-submission.dto';
import { UserTable } from 'src/users/entities/user.entity';
import { ProblemsService } from 'src/problems/problems.service';
import { SubmissionsService } from 'src/submissions/submissions.service';
import { SubmissionStatus } from 'src/submissions/entities/submission.entity';
import crypt from 'crypto';

@Injectable()
export class ScoresService {
  private scoringServers = [
    'http://10.41.177.25:3000',
    'http://10.41.177.25:3001',
    'http://10.41.177.25:3002',
  ];
  private currentServer: number = 0;

  constructor(
    private readonly problemsService: ProblemsService,
    private readonly submissionsService: SubmissionsService,
  ) {}

  async grade(
    submission: ScoreSubmissionDto,
    user: UserTable,
    isExample: boolean,
  ) {
    const { code, problemId, language } = submission;
    const problem = await this.problemsService.getProblem(problemId);

    if (!problem) {
      throw new BadRequestException('Problem does not exist');
    }

    let hashedCode = crypt.createHash('sha256').update(code).digest('hex');
    const submissionExist = await this.submissionsService.isExist(hashedCode);

    if (submissionExist) {
      return {
        message: '이미 제출된 코드입니다.',
        submission: submissionExist,
      };
    }

    const promises = [];

    for (let i = 0; i < problem.testcases.length; i++) {
      if (problem.testcases[i].isExample != isExample) continue;

      promises.push(
        fetch(`${this.scoringServers[this.currentServer]}/v2/scoring`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            language,
            timeLimit: problem.timeLimit,
            memoryLimit: problem.memoryLimit,
            testcase: problem.testcases[i],
            isExample,
          }),
        }),
      );
      this.currentServer =
        (this.currentServer + 1) % this.scoringServers.length;
    }

    let results = await Promise.all(promises);
    results = await Promise.all(results.map((result) => result.json()));
    const status = results.every((result) => result.status === 'pass')
      ? SubmissionStatus.Accepted
      : SubmissionStatus.WrongAnswer;

    if (!isExample) {
      await this.submissionsService.createSubmission({
        code,
        language,
        status,
        problemId,
        userId: user.id,
        codeHash: hashedCode,
      });
    }

    return results;
  }
}