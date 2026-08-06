import { Prisma } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { DiceNodeIntent, DiceService } from './dice.service';

interface ExistingDiceRoll {
  id: string;
  nodeId: string;
  notation: string;
}

/** 在业务事务内同步已发布正文的骰子结果，供帖子与主题聚合保存共同复用。 */
export async function reconcilePublishedDice(
  client: Pick<Prisma.TransactionClient, 'diceRoll'>,
  diceService: DiceService,
  postId: string,
  nodes: DiceNodeIntent[],
  existingRolls: ExistingDiceRoll[] = [],
) {
  const incoming = new Map(nodes.map((node) => [node.nodeId, node]));
  for (const roll of existingRolls) {
    const node = incoming.get(roll.nodeId);
    if (node && node.notation !== roll.notation) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '已结算骰子不能修改表达式；请删除后插入新的骰子节点',
      );
    }
  }

  const deletedIds = existingRolls
    .filter((roll) => !incoming.has(roll.nodeId))
    .map((roll) => roll.id);
  if (deletedIds.length > 0) {
    await client.diceRoll.deleteMany({ where: { id: { in: deletedIds }, postId } });
  }

  const existingNodeIds = new Set(existingRolls.map((roll) => roll.nodeId));
  const generated = diceService.rollNodes(
    nodes.filter((node) => !existingNodeIds.has(node.nodeId)),
  );
  if (generated.length > 0) {
    await client.diceRoll.createMany({
      data: diceService.buildCreateData(postId, generated),
    });
  }
}
